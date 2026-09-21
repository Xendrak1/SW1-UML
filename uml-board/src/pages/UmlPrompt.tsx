import React, { useEffect, useRef, useState } from 'react';
import { callar, iniciarDictado, speechDisponible } from '../lib/speech';
import { processUMLPromptDetailed } from '../services/aiPromptService';
import { aplicarAccionesIA } from '../services/applyActions';
import type { EdgeType, NodeType } from '../utils/umlConstants';
import './StylesUmlPrompt.css';

/**
 * Asistente UML del escritorio.
 *
 * Este componente es solo interfaz: recoge la instrucción —escrita o dictada—,
 * la manda a interpretar y delega la aplicación en `aplicarAccionesIA`, que es
 * el mismo módulo que usa la app móvil por voz.
 *
 * Antes tenía su propia implementación de la aplicación de acciones, distinta de
 * la del móvil. Esa duplicación causó un defecto real: la clase asociativa se
 * creaba con los nombres de sus extremos en lugar de sus identificadores, y el
 * generador de backend no podía producir la tabla intermedia. Hay un solo
 * aplicador a propósito.
 */

interface UmlPromptProps {
  isOpen: boolean;
  onClose: () => void;
  existingNodes: NodeType[];
  existingEdges: EdgeType[];
}

const EJEMPLOS = [
  'Creá una clase Mascota con nombre texto, raza texto y fecha de nacimiento',
  'Agregá el atributo peso decimal a Mascota',
  'Mascota se relaciona con Dueño, uno a muchos',
  'Relación muchos a muchos entre Médico y Paciente',
];

const UmlPrompt: React.FC<UmlPromptProps> = ({ isOpen, onClose, existingNodes, existingEdges }) => {
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ resumen: string; omitidas: string[]; proveedor: string; modo: string } | null>(null);
  const [isListening, setIsListening] = useState(false);
  const detenerRef = useRef<(() => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setResultado(null);
      setTimeout(() => textareaRef.current?.focus(), 80);
    } else {
      detenerRef.current?.();
      setIsListening(false);
      callar();
    }
  }, [isOpen]);

  // Al desmontar hay que cortar el micrófono, o sigue escuchando en segundo plano.
  useEffect(() => () => detenerRef.current?.(), []);

  const alternarDictado = () => {
    if (isListening) {
      detenerRef.current?.();
      setIsListening(false);
      return;
    }
    if (!speechDisponible()) {
      setError('Este navegador no soporta reconocimiento de voz. Escribí la instrucción.');
      return;
    }
    setError(null);
    setIsListening(true);
    // El dictado es continuo para poder hablar una frase larga sin cortes.
    detenerRef.current = iniciarDictado(
      {
        onParcial: () => undefined,
        onFinal: texto => setPrompt(previo => (previo ? `${previo} ${texto}` : texto)),
        onError: mensaje => {
          setError(mensaje);
          setIsListening(false);
        },
        onFin: () => setIsListening(false),
      },
      true
    );
  };

  const enviar = async () => {
    const instruccion = prompt.trim();
    if (!instruccion) return;

    detenerRef.current?.();
    setIsListening(false);
    setIsProcessing(true);
    setError(null);
    setResultado(null);

    try {
      const { actions, provider, modo } = await processUMLPromptDetailed(
        instruccion,
        existingNodes,
        existingEdges
      );

      if (actions.length === 0) {
        setError(
          'No interpreté ningún cambio para el diagrama. Probá con una instrucción más ' +
            'concreta, por ejemplo: "creá una clase Producto con nombre texto y precio decimal".'
        );
        return;
      }

      const res = await aplicarAccionesIA(actions, existingNodes, existingEdges);

      if (res.aplicadas === 0) {
        setError(res.resumen);
        return;
      }

      setResultado({ resumen: res.resumen, omitidas: res.omitidas, proveedor: provider, modo });
      setPrompt('');
      // Si todo salió bien, el modal se cierra solo para volver al diagrama.
      if (res.omitidas.length === 0) setTimeout(onClose, 1100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido al procesar la instrucción');
    } finally {
      setIsProcessing(false);
    }
  };

  const alTeclado = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void enviar();
    if (e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  const detener = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className='uml-prompt-overlay' onClick={onClose} onMouseDown={detener} onWheel={detener}>
      <div className='uml-prompt-modal' onClick={detener} onMouseDown={detener} onWheel={detener}>
        <div className='uml-prompt-content'>
          <div className='uml-prompt-header'>
            <h2 className='uml-prompt-title'>Asistente UML</h2>
            <button className='uml-prompt-close' onClick={onClose} aria-label='Cerrar'>
              ×
            </button>
          </div>

          <p className='uml-prompt-description'>
            Describí con tus palabras qué querés hacer con el diagrama. La IA interpreta la
            instrucción y aplica los cambios, que el resto de los participantes ve al instante.
          </p>

          <textarea
            ref={textareaRef}
            className='uml-prompt-textarea'
            placeholder='Por ejemplo: creá una clase Producto con nombre texto, precio decimal y stock entero; después Producto tiene una composición con Categoría.'
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={alTeclado}
            disabled={isProcessing}
          />

          {!prompt && !resultado && (
            <div className='muted small' style={{ marginTop: 10, lineHeight: 1.8 }}>
              Ejemplos:
              {EJEMPLOS.map(ej => (
                <div key={ej}>
                  <button
                    className='btn btn--sm btn--ghost'
                    style={{ textAlign: 'left', height: 'auto', padding: '2px 6px' }}
                    onClick={() => setPrompt(ej)}
                  >
                    “{ej}”
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className='notice notice--danger' style={{ marginTop: 14 }}>
              {error}
            </div>
          )}

          {resultado && (
            <div className='notice notice--ok' style={{ marginTop: 14 }}>
              {resultado.resumen}
              <div className='muted small' style={{ marginTop: 6 }}>
                Interpretado por IA {resultado.proveedor === 'ollama' ? 'local' : 'en la nube'}
                {resultado.modo === 'dominio' ? ' · modelo de dominio completo' : ''}
              </div>
              {resultado.omitidas.length > 0 && (
                <ul className='small' style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {resultado.omitidas.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {isProcessing && (
            <div className='uml-prompt-loading'>
              <div className='uml-prompt-spinner' />
              <span>Interpretando la instrucción...</span>
            </div>
          )}

          <div className='uml-prompt-footer'>
            <button className='uml-prompt-button' onClick={onClose} disabled={isProcessing}>
              Cerrar
            </button>
            <button
              className={`uml-prompt-button uml-prompt-button-voice${isListening ? ' listening' : ''}`}
              onClick={alternarDictado}
              disabled={isProcessing}
              title={isListening ? 'Detener el dictado' : 'Dictar la instrucción'}
            >
              {isListening ? 'Grabando...' : 'Dictar'}
            </button>
            <button
              className='uml-prompt-button uml-prompt-button-submit'
              onClick={() => void enviar()}
              disabled={isProcessing || !prompt.trim()}
              title='Ctrl+Enter'
            >
              {isProcessing ? 'Procesando...' : 'Aplicar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UmlPrompt;
