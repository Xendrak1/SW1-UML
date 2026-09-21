import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/apiClient';
import { ThemeToggle } from '../lib/theme';

/**
 * GUÍA DE USUARIO EN FORMA DE AGENTE INTELIGENTE.
 *
 * El enunciado admite que la guía de usuario sea un agente inteligente. Está
 * resuelto en dos capas, y ese orden importa:
 *
 *  1. Base de conocimiento local: preguntas y respuestas escritas, con búsqueda
 *     por palabras. Funciona sin servidor y sin IA, así que la guía nunca queda
 *     inservible — ni el día de la defensa si el modelo no arranca.
 *  2. Capa de IA: si la pregunta no encuentra respuesta en la base, se consulta
 *     al modelo (local u en la nube) pasándole la misma base como contexto.
 *     Así responde en lenguaje natural sin inventar funciones que no existen.
 */

interface Entrada {
  id: string;
  seccion: string;
  pregunta: string;
  respuesta: string;
  claves: string[];
}

const GUIA: Entrada[] = [
  {
    id: 'crear-clase',
    seccion: 'Modelado',
    pregunta: '¿Cómo creo una clase?',
    respuesta:
      'En la barra superior, el botón "+ Clase" agrega una clase al centro del lienzo. Después hacés doble clic sobre su nombre para renombrarla, y con el botón "+" dentro de la clase agregás atributos indicando nombre, tipo y visibilidad.',
    claves: ['clase', 'crear', 'nueva', 'agregar', 'entidad', 'tabla'],
  },
  {
    id: 'crear-relacion',
    seccion: 'Modelado',
    pregunta: '¿Cómo relaciono dos clases?',
    respuesta:
      'Dentro de cada clase hay botones para iniciar una relación: elegís el tipo (asociación, agregación, composición, herencia o dependencia) y las multiplicidades, y luego hacés clic en la clase destino. Para una relación muchos a muchos usá el menú "Modelar → Relación muchos a muchos": crea automáticamente la clase asociativa intermedia con sus dos relaciones.',
    claves: ['relacion', 'relación', 'asociacion', 'herencia', 'composicion', 'agregacion', 'unir', 'conectar', 'flecha', 'muchos'],
  },
  {
    id: 'asistente',
    seccion: 'Asistente de IA',
    pregunta: '¿Cómo uso el asistente por voz o texto?',
    respuesta:
      'En "Modelar → Asistente por voz o texto" se abre una caja donde podés escribir o dictar la instrucción, por ejemplo "creá una clase Mascota con nombre texto y edad entero" o "Mascota se relaciona con Dueño, uno a muchos". El asistente interpreta la frase y aplica los cambios al diagrama. Requiere IA disponible: Ollama local o una clave de OpenAI configurada en el servidor.',
    claves: ['asistente', 'voz', 'dictar', 'hablar', 'ia', 'prompt', 'texto', 'microfono', 'micrófono'],
  },
  {
    id: 'foto',
    seccion: 'Asistente de IA',
    pregunta: '¿Puedo importar un diagrama a partir de una foto?',
    respuesta:
      'Sí. En "Intercambio → Importar desde una foto" subís una imagen del diagrama —una foto de la pizarra, un boceto o una captura— y la IA con visión reconstruye las clases, los atributos y las relaciones. Para que salga bien, la foto tiene que estar de frente, enfocada y con los nombres legibles.',
    claves: ['foto', 'imagen', 'camara', 'cámara', 'pizarra', 'papel', 'escanear', 'captura'],
  },
  {
    id: 'backend',
    seccion: 'Generación',
    pregunta: '¿Cómo genero el backend?',
    respuesta:
      'En "Generar → Backend Spring Boot" se descarga un ZIP con el proyecto completo: entidades JPA con sus claves foráneas, repositorios, servicios, controladores REST, el pom.xml y el application.properties. Se descomprime y se levanta con "mvn spring-boot:run". Junto con eso se genera una colección de Postman para probar los endpoints.',
    claves: ['backend', 'spring', 'java', 'generar', 'codigo', 'código', 'zip', 'jpa', 'rest', 'postman'],
  },
  {
    id: 'datos',
    seccion: 'Diseño de datos',
    pregunta: '¿Qué hace la pantalla de diseño de datos?',
    respuesta:
      'Recorre la fase de diseño de datos completa a partir del diagrama de clases: el modelo conceptual con sus entidades y cardinalidades, el mapeo objeto-relacional con las reglas de Rumbaugh R1 a R9, el esquema lógico con tablas y claves, el análisis de normalización hasta 3FN con justificación escrita, y el DDL ejecutable para PostgreSQL o MySQL. Todo se deriva del diagrama de forma determinística, sin IA.',
    claves: ['datos', 'normalizacion', 'normalización', 'rumbaugh', 'mapeo', 'ddl', 'sql', '3fn', 'conceptual', 'esquema', 'tablas'],
  },
  {
    id: 'colaboracion',
    seccion: 'Colaboración',
    pregunta: '¿Cómo trabajo en la misma pizarra con otras personas?',
    respuesta:
      'Desde el menú de la pizarra, "Copiar enlace para invitar" te da la dirección para compartir. Quien la abra entra a la misma pizarra y ve los cambios al instante. En la barra aparecen los participantes conectados con su color, y cuál clase está tocando cada uno. Cada cambio viaja como una operación independiente, así que dos personas editando cosas distintas no se pisan.',
    claves: ['colaborar', 'colaboracion', 'colaboración', 'compartir', 'invitar', 'equipo', 'juntos', 'participantes', 'tiempo real'],
  },
  {
    id: 'offline',
    seccion: 'Colaboración',
    pregunta: '¿Qué pasa si se corta internet?',
    respuesta:
      'Podés seguir trabajando. Cada cambio se guarda en el dispositivo antes de intentar enviarse, y la barra muestra "Sin conexión" junto con cuántos cambios quedaron en cola. Cuando vuelve la red se envían solos y se recibe lo que hicieron los demás mientras no estabas. Los cambios sobreviven incluso si cerrás la pestaña o recargás la página.',
    claves: ['offline', 'internet', 'conexion', 'conexión', 'red', 'cortó', 'corto', 'sin conexion', 'desconecta', 'cola'],
  },
  {
    id: 'movil',
    seccion: 'App móvil',
    pregunta: '¿Cómo uso la app en el celular?',
    respuesta:
      'Entrá a la dirección del servidor terminada en /voz desde el celular e instalala con "Agregar a la pantalla de inicio". La app móvil no tiene interfaz gráfica: tiene un solo botón de micrófono y responde hablando. Le dictás lo que querés hacer y ella aplica los cambios en la misma pizarra compartida.',
    claves: ['celular', 'movil', 'móvil', 'telefono', 'teléfono', 'pwa', 'instalar', 'app', 'android', 'iphone'],
  },
  {
    id: 'intercambio',
    seccion: 'Intercambio',
    pregunta: '¿Puedo llevar el diagrama a otra herramienta CASE?',
    respuesta:
      'Sí, en XMI 2.5, que es el formato estándar de intercambio de UML que leen la mayoría de las herramientas. Elegís el formato en "Intercambio → Exportar" y descargás. La importación reconoce el mismo formato, más el JSON propio de la herramienta. El adaptador nativo de Architech está preparado pero todavía no implementado: falta un archivo de ejemplo de ese formato.',
    claves: ['architech', 'xmi', 'exportar', 'importar', 'otra herramienta', 'case', 'intercambio', 'formato', 'json'],
  },
  {
    id: 'tema',
    seccion: 'Interfaz',
    pregunta: '¿Cómo cambio entre tema claro y oscuro?',
    respuesta:
      'Con el botón de sol o luna al final de la barra: un clic alterna entre claro y oscuro. Con clic derecho sobre ese mismo botón podés elegir "Seguir al sistema", para que acompañe la configuración de Windows.',
    claves: ['tema', 'oscuro', 'claro', 'dark', 'light', 'color', 'modo noche', 'apariencia'],
  },
  {
    id: 'problemas',
    seccion: 'Problemas',
    pregunta: 'Dice "Sin conexión" o "IA no disponible", ¿qué reviso?',
    respuesta:
      'Las dos cosas juntas suelen significar que el servidor no está corriendo: verificá que la terminal de la carpeta server siga activa con "npm run dev" y que Postgres esté arriba con "docker compose ps". La pantalla de Diagnóstico muestra el estado del servidor y de cada proveedor de IA por separado, así que te dice cuál de los dos falta.',
    claves: ['error', 'no funciona', 'problema', 'sin conexion', 'no disponible', 'falla', 'servidor', 'diagnostico', 'diagnóstico'],
  },
];

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Búsqueda por coincidencia de palabras: corre en el dispositivo, sin IA. */
function buscar(consulta: string): Entrada[] {
  const q = normalizar(consulta);
  if (q.trim().length < 2) return [];
  const palabras = q.split(/\s+/).filter(p => p.length > 2);

  return GUIA.map(e => {
    const texto = normalizar(`${e.pregunta} ${e.respuesta} ${e.claves.join(' ')}`);
    let puntos = 0;
    for (const clave of e.claves) {
      if (q.includes(normalizar(clave))) puntos += 3;
    }
    for (const p of palabras) {
      if (texto.includes(p)) puntos += 1;
    }
    return { e, puntos };
  })
    .filter(r => r.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .map(r => r.e);
}

type Mensaje = { de: 'usuario' | 'guia'; texto: string; fuente?: string };

const GuidePage: React.FC = () => {
  const [consulta, setConsulta] = useState('');
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [pensando, setPensando] = useState(false);

  const secciones = useMemo(() => [...new Set(GUIA.map(e => e.seccion))], []);

  const preguntar = async (texto: string) => {
    const pregunta = texto.trim();
    if (!pregunta) return;

    setMensajes(m => [...m, { de: 'usuario', texto: pregunta }]);
    setConsulta('');

    // Capa 1: la base local. Instantánea y no depende de nada externo.
    const locales = buscar(pregunta);
    if (locales.length > 0) {
      setMensajes(m => [
        ...m,
        { de: 'guia', texto: locales[0].respuesta, fuente: `Guía · ${locales[0].seccion}` },
      ]);
      return;
    }

    // Capa 2: la IA, con la guía como contexto para que no invente funciones.
    setPensando(true);
    try {
      const contexto = GUIA.map(e => `P: ${e.pregunta}\nR: ${e.respuesta}`).join('\n\n');
      const res = await api.ask(pregunta, contexto);
      setMensajes(m => [...m, { de: 'guia', texto: res.answer, fuente: `IA · ${res.provider}` }]);
    } catch {
      setMensajes(m => [
        ...m,
        {
          de: 'guia',
          texto:
            'No encontré eso en la guía escrita, y no pude consultar a la IA (revisá que el servidor esté corriendo). Abajo están todas las preguntas frecuentes por tema.',
          fuente: 'Guía',
        },
      ]);
    } finally {
      setPensando(false);
    }
  };

  return (
    <div className='page'>
      <div className='page__head'>
        <h1 className='page__title'>Guía de usuario</h1>
        <Link to='/' className='btn'>
          ← Volver a la pizarra
        </Link>
        <div style={{ flex: 1 }} />
        <ThemeToggle />
      </div>
      <p className='page__sub'>
        Preguntá con tus palabras. Primero se busca en la guía escrita, que funciona sin conexión;
        si no hay respuesta, se consulta a la IA usando esa misma guía como referencia.
      </p>

      <div className='card'>
        <div className='row' style={{ gap: 8 }}>
          <input
            className='input'
            style={{ flex: 1, minWidth: 220 }}
            placeholder='Por ejemplo: cómo genero el backend'
            value={consulta}
            onChange={e => setConsulta(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void preguntar(consulta);
            }}
          />
          <button
            className='btn btn--primary'
            onClick={() => void preguntar(consulta)}
            disabled={pensando || consulta.trim().length === 0}
          >
            Preguntar
          </button>
        </div>

        {mensajes.length > 0 && (
          <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mensajes.map((m, i) => (
              <div
                key={i}
                className={m.de === 'usuario' ? 'notice' : 'notice notice--ok'}
                style={{
                  alignSelf: m.de === 'usuario' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                }}
              >
                {m.texto}
                {m.fuente && (
                  <div className='muted small' style={{ marginTop: 6 }}>
                    {m.fuente}
                  </div>
                )}
              </div>
            ))}
            {pensando && (
              <div className='row muted small'>
                <span className='spin' /> Consultando a la IA...
              </div>
            )}
          </div>
        )}
      </div>

      <div className='card'>
        <h3 className='card__title'>Preguntas frecuentes</h3>
        {secciones.map(seccion => (
          <div key={seccion} style={{ marginBottom: 18 }}>
            <div className='muted small' style={{ fontWeight: 600, marginBottom: 8 }}>
              {seccion.toUpperCase()}
            </div>
            {GUIA.filter(e => e.seccion === seccion).map(e => (
              <details key={e.id} style={{ marginBottom: 6 }}>
                <summary style={{ cursor: 'pointer', padding: '6px 0', fontWeight: 500 }}>
                  {e.pregunta}
                </summary>
                <p className='muted' style={{ margin: '4px 0 10px', lineHeight: 1.65 }}>
                  {e.respuesta}
                </p>
              </details>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GuidePage;
