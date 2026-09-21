import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useBoards } from '../hooks/useDiagramSync';
import { flowEdgesToUml, flowNodesToUml } from '../lib/flowToUml';
import { interpretarLocal } from '../lib/iaLocal';
import { callar, hablar, iniciarDictado, speechDisponible } from '../lib/speech';
import { ThemeToggle } from '../lib/theme';
import { aplicarAccionesIA } from '../services/applyActions';
import { processUMLPromptDetailed, type DiagramAction } from '../services/aiPromptService';
import { useClassStore } from '../store/classStore';

/**
 * APP MOVIL: asistente de voz sin interfaz grafica.
 *
 * El enunciado pide que en el celular no haya interfaz grafica y que todo el flujo
 * se haga hablando. Esta pantalla tiene un solo control (tocar para hablar) y
 * responde unicamente por voz; lo que se ve en pantalla es la transcripcion, para
 * que el docente pueda seguir lo que esta pasando durante la demostracion.
 *
 * TODO CORRE SIN INTERNET, que es lo que pide el enunciado para el celular:
 *   - el reconocimiento de voz, con la Web Speech API del sistema operativo;
 *   - los datos, con la cola de operaciones en IndexedDB;
 *   - y la interpretacion, con el interprete de lib/iaLocal.ts, que vive en el
 *     telefono.
 *
 * Con red se usa el modelo del servidor -Ollama o la nube-, que entiende
 * lenguaje libre. Sin red, o si la peticion falla, entra el interprete local,
 * que cubre las ordenes de modelado frecuentes. La respuesta dice siempre cual
 * de los dos contesto, para que en la demostracion se vea.
 */

const AYUDA = [
  'Creá una clase Mascota con nombre texto y edad entero',
  'Agregá el atributo raza a Mascota',
  'Mascota se relaciona con Dueño, uno a muchos',
  'Consulta hereda de Atención',
  'Relación muchos a muchos entre Médico y Paciente',
  'Qué hay en el diagrama',
];

type Estado = 'inactivo' | 'escuchando' | 'procesando' | 'hablando';

// El estado se comunica por color: es la unica retroalimentacion visual que
// tiene una pantalla sin controles.
const COLOR_ESTADO: Record<Estado, string> = {
  inactivo: 'var(--accent)',
  escuchando: 'var(--danger)',
  procesando: 'var(--warn)',
  hablando: 'var(--ok)',
};

const ETIQUETA_ESTADO: Record<Estado, string> = {
  inactivo: 'Tocá para hablar',
  escuchando: 'Escuchando...',
  procesando: 'Pensando...',
  hablando: 'Respondiendo',
};

const VoiceAssistant: React.FC = () => {
  const { boards } = useBoards();
  const nodes = useClassStore(s => s.nodes);
  const edges = useClassStore(s => s.edges);
  const connection = useClassStore(s => s.connection);
  const pendingOps = useClassStore(s => s.pendingOps);
  const loadDiagram = useClassStore(s => s.loadDiagram);
  const cleanup = useClassStore(s => s.cleanupRealtimeSync);

  const [estado, setEstado] = useState<Estado>('inactivo');
  const [transcripcion, setTranscripcion] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [historial, setHistorial] = useState<Array<{ yo: string; asistente: string }>>([]);
  const detenerRef = useRef<(() => void) | null>(null);
  const diagramaRef = useRef<string | null>(null);

  // Nos conectamos a la pizarra recordada, o a la primera: en el celular no hay
  // menu que elegir.
  useEffect(() => {
    const recordada = localStorage.getItem('case.boardId');
    const board = boards.find(b => b.id === recordada) ?? boards[0];
    const diagramId = board?.diagram_id;
    if (!diagramId || diagramaRef.current === diagramId) return;
    diagramaRef.current = diagramId;
    void loadDiagram(diagramId);
  }, [boards, loadDiagram]);

  useEffect(() => () => cleanup(), [cleanup]);

  const responder = useCallback((texto: string) => {
    setRespuesta(texto);
    setEstado('hablando');
    hablar(texto);
    // La sintesis no avisa de forma fiable en todos los navegadores moviles:
    // estimamos la duracion por el largo del texto.
    const ms = Math.min(12000, 1200 + texto.length * 55);
    setTimeout(() => setEstado('inactivo'), ms);
  }, []);

  const procesar = useCallback(
    async (texto: string) => {
      setEstado('procesando');
      const umlNodes = flowNodesToUml(nodes);
      const umlEdges = flowEdgesToUml(edges);

      // Consulta de estado: se contesta en el dispositivo, sin gastar una llamada a la IA.
      const normalizado = texto.toLowerCase();
      if (/(qu[eé] hay|qu[eé] tiene|resum|estado del diagrama|cu[aá]ntas clases)/.test(normalizado)) {
        const resumen =
          umlNodes.length === 0
            ? 'El diagrama está vacío.'
            : `El diagrama tiene ${umlNodes.length} clases: ${umlNodes.map(n => n.label).join(', ')}. Y ${umlEdges.length} relaciones.`;
        setHistorial(h => [{ yo: texto, asistente: resumen }, ...h].slice(0, 20));
        responder(resumen);
        return;
      }

      /**
       * Interpreta con el modelo del servidor si hay red, y con el interprete
       * del telefono si no. El respaldo tambien cubre el caso molesto: el
       * navegador cree que hay red pero el servidor no contesta.
       */
      const interpretar = async (): Promise<{ actions: DiagramAction[]; fuente: string; aviso?: string }> => {
        const sinRed = connection === 'offline' || !navigator.onLine;
        if (!sinRed) {
          try {
            const { actions, provider } = await processUMLPromptDetailed(texto, umlNodes, umlEdges);
            return { actions, fuente: `IA ${provider === 'ollama' ? 'local' : 'en la nube'}` };
          } catch {
            // Sin propagar: el interprete del telefono puede resolverlo.
          }
        }
        const local = interpretarLocal(texto, umlNodes, umlEdges);
        if (!local.reconocido) {
          return { actions: [], fuente: 'IA del teléfono', aviso: local.entendido };
        }
        return { actions: local.actions, fuente: 'IA del teléfono, sin conexión' };
      };

      try {
        const { actions, fuente, aviso } = await interpretar();

        if (actions.length === 0) {
          const mensaje = aviso ?? 'No interpreté ningún cambio para el diagrama.';
          setHistorial(h => [{ yo: texto, asistente: mensaje }, ...h].slice(0, 20));
          responder(mensaje);
          return;
        }

        const resultado = await aplicarAccionesIA(actions, umlNodes, umlEdges);
        const conProveedor =
          connection === 'offline'
            ? `${resultado.resumen} Estás sin conexión, así que lo guardé en el teléfono y lo sincronizo al volver la red.`
            : resultado.resumen;
        setHistorial(h =>
          [{ yo: texto, asistente: `${conProveedor} (${fuente})` }, ...h].slice(0, 20)
        );
        responder(conProveedor);
      } catch (err) {
        const mensaje =
          err instanceof Error
            ? 'No pude procesar eso. ' + err.message.slice(0, 120)
            : 'Ocurrió un error.';
        setHistorial(h => [{ yo: texto, asistente: mensaje }, ...h].slice(0, 20));
        responder(mensaje);
      }
    },
    [nodes, edges, connection, responder]
  );

  const alternarEscucha = useCallback(() => {
    callar();
    if (estado === 'escuchando') {
      detenerRef.current?.();
      setEstado('inactivo');
      return;
    }

    setTranscripcion('');
    setRespuesta('');
    setEstado('escuchando');

    detenerRef.current = iniciarDictado({
      onParcial: setTranscripcion,
      onFinal: texto => {
        setTranscripcion(texto);
        detenerRef.current?.();
        void procesar(texto);
      },
      onError: mensaje => {
        setEstado('inactivo');
        responder(mensaje);
      },
      onFin: () => {
        // Si termino sin resultado final, volvemos a inactivo.
        setEstado(actual => (actual === 'escuchando' ? 'inactivo' : actual));
      },
    });
  }, [estado, procesar, responder]);

  if (!speechDisponible()) {
    return (
      <div className='page' style={{ textAlign: 'center' }}>
        <h2>Este navegador no soporta reconocimiento de voz</h2>
        <p>Usá Chrome en Android, o Safari en iOS 15 o superior.</p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '24px 16px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ textAlign: 'center', fontSize: 13, opacity: 0.7, width: '100%' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBottom: 8,
          }}
        >
          <ThemeToggle compact />
        </div>
        <div>
          {connection === 'online' ? 'Conectado' : connection === 'connecting' ? 'Conectando' : 'Sin conexión'}
          {pendingOps > 0 && ` — ${pendingOps} cambio${pendingOps === 1 ? '' : 's'} en cola`}
        </div>
        <div style={{ marginTop: 4 }}>
          {nodes.length} clases, {edges.length} relaciones
        </div>
      </div>

      {/* Unico control de toda la app movil */}
      <button
        onClick={alternarEscucha}
        aria-label={ETIQUETA_ESTADO[estado]}
        style={{
          width: 200,
          height: 200,
          borderRadius: '50%',
          border: 'none',
          background: COLOR_ESTADO[estado],
          color: '#fff',
          fontSize: 64,
          cursor: 'pointer',
          boxShadow:
            estado === 'escuchando'
              ? '0 0 0 18px color-mix(in srgb, var(--danger) 22%, transparent)'
              : 'var(--shadow-2)',
          transition: 'box-shadow 0.3s, background 0.3s',
        }}
      >
        {estado === 'escuchando' ? '◉' : estado === 'procesando' ? '···' : '🎙'}
      </button>

      <div style={{ textAlign: 'center', minHeight: 140, maxWidth: 480 }}>
        <p style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>
          {ETIQUETA_ESTADO[estado]}
        </p>
        {transcripcion && (
          <p style={{ fontSize: 16, opacity: 0.85, margin: '0 0 12px' }}>“{transcripcion}”</p>
        )}
        {respuesta && <p style={{ fontSize: 15, color: 'var(--ok)', margin: 0 }}>{respuesta}</p>}
      </div>

      <details style={{ width: '100%', maxWidth: 480, fontSize: 13, opacity: 0.75 }}>
        <summary style={{ cursor: 'pointer', padding: 8 }}>Qué le puedo decir</summary>
        <ul style={{ lineHeight: 1.8 }}>
          {AYUDA.map(a => (
            <li key={a}>“{a}”</li>
          ))}
        </ul>
      </details>

      {historial.length > 0 && (
        <details style={{ width: '100%', maxWidth: 480, fontSize: 12, opacity: 0.6 }}>
          <summary style={{ cursor: 'pointer', padding: 8 }}>
            Historial de la sesión ({historial.length})
          </summary>
          <ol style={{ lineHeight: 1.6 }}>
            {historial.map((h, i) => (
              <li key={i} style={{ marginBottom: 8 }}>
                <div>Yo: {h.yo}</div>
                <div style={{ opacity: 0.8 }}>Asistente: {h.asistente}</div>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
};

export default VoiceAssistant;
