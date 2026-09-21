# Herramienta CASE colaborativa — Ingeniería de Software 1

Aplicación de Ingeniería de Software Asistida por Computadora: modelado UML de clases
en forma colaborativa, diseño de datos completo (conceptual → mapeo → normalización)
y generación del backend Spring Boot a partir del diagrama.

## Arranque rápido

Hacen falta Node 18+ y Docker (solo para la base de datos).

```bash
# 1. Base de datos (Postgres en el puerto 5433)
docker compose up -d

# 2. Backend
cd server
cp .env.example .env
npm install
npm run dev            # http://localhost:4000

# 3. Frontend (en otra terminal)
cd uml-board
cp .env.example .env
npm install
npm run dev            # http://localhost:5173
```

Para verificar que todo está en pie, abrí <http://localhost:5173/debug>.

### IA: local y en la nube

La capa de IA es intercambiable y se configura en `server/.env` con `AI_STRATEGY`:

| Valor | Comportamiento |
| --- | --- |
| `local` | solo Ollama, en la máquina |
| `cloud` | solo OpenAI |
| `hybrid` | intenta Ollama y, si no está disponible, usa OpenAI (por defecto) |

Para la IA local:

```bash
# instalar Ollama desde https://ollama.com y luego
ollama pull qwen2.5:7b-instruct        # texto (asistente UML)
ollama pull llama3.2-vision:11b        # visión (diagramas por foto)
```

Para la nube, poné tu propia clave en `OPENAI_API_KEY` dentro de `server/.env`.
`hybrid` es lo recomendado para la defensa: si el modelo local no arranca, la
demostración no se cae.

### Los dos modos del asistente UML

El servidor elige el prompt según lo que pidas, porque no es lo mismo una
edición puntual que modelar un negocio entero:

| Modo | Cuándo se activa | Qué devuelve |
| --- | --- | --- |
| `atomico` | "agregá el atributo precio a Producto", "Auto hereda de Vehículo", "borrá la clase Factura" | las una o dos acciones pedidas, en una sola llamada |
| `dominio` | "creá la base de datos de una cafetería tipo Starbucks", "modelá el sistema de una veterinaria", "quiero al menos 10 tablas" | el modelo completo, en dos llamadas: clases con atributos y después relaciones |

La respuesta trae `modo` y `etapas` (por ejemplo
`["clases=12","relaciones=12"]`) para ver exactamente qué hizo.

#### Por qué el modo dominio va en dos etapas

Tres cosas lo rompían, y las tres están resueltas:

- **`num_ctx`**: Ollama trunca el contexto *en silencio* cuando el prompt pasa
  la ventana del modelo (por defecto 4096, en algunos 2048). El modelo perdía
  las reglas y los ejemplos, y pedirle el modelo de un negocio completo
  devolvía una sola clase. Ahora se manda explícito: 8192 en modo atómico y
  12288 en modo dominio.
- **la escala de los ejemplos**: un modelo de 7B imita el *tamaño* de los
  ejemplos que ve. Con solo ejemplos atómicos respondía con una clase.
- **el JSON gigante**: un 7B no sostiene treinta y cinco acciones en una sola
  respuesta: se pierde, repite clases, inventa relaciones con clases que nunca
  creó, o se corta. Por eso el modelo se arma en **dos llamadas cortas**:
  primero las clases con sus atributos, después las relaciones **sobre la
  lista ya cerrada** de clases de la etapa 1. Esa lista real es lo que elimina
  las relaciones a clases inexistentes: si el modelo nombra una, se descarta
  ahí mismo y queda anotado en `etapas`.

Y tres redes de contención:

- si la etapa 1 devuelve **menos clases de las pedidas**, se le piden una vez
  más solo las que faltan (`etapas: ["clases=4","completadas=+5"]`);
- si la etapa 2 falla, **se devuelven igual las clases**: un modelo sin
  relaciones se completa a mano en un minuto, perder el modelo entero no;
- si cualquiera de las dos se **corta a mitad del JSON**, se rescatan los
  elementos que ya cerraron bien en vez de perder todo.

El máximo es de 20 clases, para que un "hacé 100 tablas" no cuelgue la demo.

### Si algo de la IA falla

El endpoint distingue el fallo del servidor del problema que podés resolver
vos. Un modelo sin descargar devuelve **503** con el comando exacto
(`ollama pull llama3.2-vision:11b`) en vez de un 500 genérico, y `/debug`
muestra qué modelos hay realmente descargados y marca **sin descargar** el que
falte.

El error más común: el nombre en `server/.env` tiene que coincidir **exacto**
con lo que muestra `ollama list`. Tener `qwen2.5-coder:7b` bajado y
`OLLAMA_MODEL=qwen2.5:7b-instruct` en el `.env` falla con un 404.
La importación por foto usa `OLLAMA_VISION_MODEL`, que es un modelo **aparte**
del de texto: si nunca hiciste `ollama pull llama3.2-vision:11b`, la foto no va
a funcionar aunque el asistente de texto sí.

### Probar la app móvil en el celular

1. Averiguá la IP de la PC en la red local (`ipconfig` en Windows).
2. En `uml-board/.env`: `VITE_API_URL=http://TU_IP:4000`
3. `npm run dev -- --host` en `uml-board/`
4. Desde el celular, entrá a `http://TU_IP:5173/voz` e instalá la PWA
   ("Agregar a la pantalla de inicio").

## Pantallas

| Ruta | Para qué |
| --- | --- |
| `/` | Editor visual del diagrama de clases (escritorio) |
| `/datos` | Fase de diseño de datos: conceptual, mapeo, esquema, normalización, DDL |
| `/guia` | Guía de usuario en forma de agente: busca en la guía escrita y, si no alcanza, pregunta a la IA |
| `/voz` | App móvil: asistente de voz, sin interfaz gráfica |
| `/debug` | Diagnóstico del backend y de la capa de IA |

### Interfaz

Un solo juego de tokens CSS en `uml-board/src/styles/theme.css` define colores,
tipografía y medidas, y se redefine para el tema oscuro. Ningún componente escribe
colores literales, así que cambiar de tema no requiere tocarlos.

El tema tiene tres estados: claro, oscuro y seguir al sistema (el de por defecto).
Se cambia con el botón de sol/luna al final de la barra —un clic alterna, clic
derecho abre las tres opciones— y la elección se guarda en el navegador.

La barra de herramientas agrupa las acciones por intención (Modelar, Intercambio,
Generar, Más) en vez de mostrarlas todas sueltas; el zoom vive en un control
flotante sobre el lienzo y el aviso de modo aparece solo cuando hay un modo activo.

## Arquitectura

```
proyecto-software-1/
├── docker-compose.yml       Postgres de la aplicación
├── server/                  Backend propio (Node + Express + WebSocket + Postgres)
│   ├── sql/schema.sql       Esquema: diagrams, boards, diagram_ops, uploads
│   └── src/
│       ├── collab.ts        Aplicación de operaciones sobre el documento
│       ├── rooms.ts         Orden total por diagrama y persistencia transaccional
│       ├── ws.ts            Sesiones, presencia y puesta al día tras reconectar
│       ├── ai/              Proveedores de IA (Ollama / OpenAI) y prompts
│       └── routes/          REST: pizarras, diagramas, bitácora, IA, imágenes
└── uml-board/               Frontend (React + TypeScript + Vite + ReactFlow)
    └── src/
        ├── lib/
        │   ├── collabClient.ts   Cliente colaborativo: optimista + reconexión
        │   ├── offlineQueue.ts   Cola de operaciones y caché en IndexedDB
        │   ├── speech.ts         Reconocimiento y síntesis de voz en el dispositivo
        │   └── theme.tsx         Tema claro / oscuro / seguir al sistema
        ├── styles/theme.css      Tokens de diseño; se redefinen para el tema oscuro
        ├── store/classStore.ts   Estado del editor; cada acción emite una operación
        ├── utils/
        │   ├── dataDesign.ts     Conceptual, mapeo Rumbaugh, normalización, DDL
        │   ├── architech.ts      Registro de adaptadores CASE (JSON, XMI 2.5/2.1, EA 15)
        │   ├── enterpriseArchitect.ts  Ida y vuelta con Enterprise Architect 15
        │   ├── backendGenerator.ts   Generación del backend Spring Boot
        │   └── frontendGenerator.ts  Generación de un frontend de prueba
        ├── components/           Barra, menús, nodos y aristas del diagrama
        └── pages/                Pizarra, diseño de datos, guía, asistente de voz, debug
```

### Cómo se resuelve el trabajo colaborativo

El problema central de una herramienta CASE compartida es que varias personas editan
el mismo modelo a la vez. Las decisiones tomadas:

- **Operaciones granulares, no documentos completos.** Cada acción del usuario viaja
  como una operación (`node.add`, `node.update`, `edge.remove`, …). Dos personas
  editando clases distintas —o campos distintos de la misma clase— no se pisan.
- **Orden total por diagrama.** El servidor asigna un número de secuencia creciente
  a cada operación aceptada. Ese orden es el que comparten todos los clientes, y es
  lo que decide el resultado cuando dos cambios llegan a la vez.
- **Aplicación optimista.** El cambio se ve al instante en la pantalla de quien lo
  hizo y se confirma después; la latencia no se siente.
- **Idempotencia por `opId`.** Cada operación lleva un identificador generado por el
  cliente, con restricción de unicidad en la base. Reenviar la cola tras reconectar
  no duplica nada.
- **Tombstones.** Una operación tardía sobre algo que otra persona ya borró se
  descarta en vez de resucitarlo.
- **Resincronización ante divergencia.** Si el servidor rechaza una operación, el
  cliente sabe que su estado optimista quedó mal y pide el documento completo.
- **Presencia.** Nombre, color y qué clase está tocando cada participante.

### Cómo se resuelve la desconexión

- Cada operación se persiste en **IndexedDB antes** de intentar enviarse, así
  sobrevive a un corte de red, a cerrar la pestaña y a recargar la página.
- El documento queda en caché local: la app abre y se puede seguir trabajando sin
  servidor.
- Al volver la red se reenvía la cola completa y se pide lo que se perdió. Si la
  desconexión fue corta se transfieren solo las operaciones faltantes; si fue larga,
  el documento entero.
- La interfaz muestra en todo momento si hay conexión y cuántos cambios están en cola.

## Estado de los requisitos

| Requisito | Estado |
| --- | --- |
| Editor de diagrama de clases UML 2.5 | listo |
| Diagrama por foto | listo (visión local o nube) |
| Diagrama por voz y por texto | listo |
| Trabajo colaborativo con resolución de conflictos | listo |
| Funcionamiento local y ante desconexión | listo |
| Diseño de datos: conceptual, mapeo Rumbaugh, normalización, DDL | listo |
| Generación de backend Spring Boot | listo |
| Pruebas con Postman | listo (colección generada) |
| App móvil sin interfaz gráfica, por voz | listo (PWA instalable) |
| Guía de usuario como agente inteligente | listo (`/guia`) |
| Tema claro y oscuro | listo |
| IA local + nube | listo (Ollama + OpenAI, intercambiables) |
| Intercambio con otras herramientas CASE | listo: abre `.eapx` de EA directo, y exporta en XMI 2.1, script de EA, XMI 2.5 y JSON |
| Documentación PUDS y fundamentación teórica | **pendiente** |

### Lo que falta y qué hace falta para cerrarlo

1. **Documentación PUDS.** Es la primera parte que se evalúa y debe estar publicada
   antes de las 8:00 del día de la entrega. Los diagramas se generan con los
   scripts de `docs/ea/` (ver abajo).

## Intercambio con Enterprise Architect 15

La herramienta que el enunciado llama *Architech* es **Sparx Enterprise
Architect 15.0.1514**, que guarda el proyecto en un `.eapx`: una base Access con
el esquema propio de EA (`t_object`, `t_connector`, `t_attribute`, `t_diagram`,
`t_diagramobjects` y unas 90 tablas más). Escribir ese archivo desde el
navegador no es viable, y escribirlo a mano es la forma conocida de corromper un
proyecto, así que el intercambio va por donde EA sí lo soporta oficialmente: su
motor de automatización.

### EA → CASE: abrir el `.eapx` directo

**Arrastrá el `.eapx` al lienzo**, o `Intercambio > Importar > Desde Enterprise
Architect`. No hay ningún paso en EA.

El archivo se sube al servidor, que lo lee con `mdb-reader` (un `.eapx` es una
base Access) y devuelve los diagramas de clases que contiene. Si hay uno solo se
abre directo; si hay varios, un selector los muestra con su cantidad de clases y
la ruta de su paquete, porque un proyecto real tiene varios diagramas con el
mismo nombre en paquetes distintos. Lo implementa `server/src/case/eapx.ts`.

### CASE → EA

| Formato | Cómo se abre en EA |
| --- | --- |
| **XMI 2.1** | `Project > Model Import/Export > Import Package from XMI`. El camino sin scripts. |
| **Script del modelo** | JScript que se pega en el Script Editor de EA. Usa la API de automatización, así que no depende de que EA acepte un XMI. |
| **Estructura del documento** | Lo mismo, pero además arma el árbol PUDS completo, los casos de uso, las clases dinámicas y los diagramas de secuencia. |

Los dos scripts, con instrucciones, están en [`docs/ea/`](docs/ea/README.md).

> El XMI 2.1 está escrito en el dialecto de EA (namespaces `schema.omg.org`,
> clases dentro de un `uml:Package`, `memberEnd` además de `ownedEnd`, tipos por
> `xmi:idref`), y validado como XML con referencias internas consistentes —
> pero **no se pudo probar contra EA**, porque en el entorno donde se escribió no
> hay EA instalado. Si EA rechaza el archivo, el script hace el mismo trabajo por
> la API de automatización.

El mapeo no se adivinó: sale de leer un `.eapx` real hecho con EA 15. El punto
delicado es la composición, porque las dos herramientas la guardan en sentidos
opuestos: acá el todo va en `source`, y en EA el conector arranca en la parte
con el rombo en el extremo *Supplier*. Está explicado en
`uml-board/src/utils/enterpriseArchitect.ts` y cubierto por los tests.

Los scripts listos para correr, con las instrucciones, están en
[`docs/ea/`](docs/ea/README.md).

## Pruebas

```bash
# Colaboración: tres sesiones, offline, idempotencia, tombstones
cd server && node test-collab.mjs        # requiere el servidor corriendo

# Capa de IA: 50 comprobaciones sin necesidad de un modelo real.
# mock-ollama.mjs simula la API de Ollama, incluidas las respuestas mal formadas
# que da un modelo de 7B: JSON envuelto en markdown, tipos inventados,
# multiplicidades como "0..*", muchos a muchos directo, basura total, y el
# modelo no descargado.
cd server
node mock-ollama.mjs &                   # simulador en el puerto 11434
npm run dev &                            # con AI_STRATEGY=local
node test-ia.mjs

# Modo dominio: 62 comprobaciones. Verifica que "la base de datos de una
# cafeteria tipo Starbucks" produzca el modelo completo y no una sola clase,
# que las ediciones puntuales NO disparen el modo dominio, las dos etapas, el
# completado cuando queda corto, el rescate de una respuesta cortada, y el
# diagnostico de un modelo sin descargar.
node test-dominio.mjs

# Lectura de un .eapx real de EA 15: 25 comprobaciones (requiere el servidor).
cd server && node test-eapx.mjs

# Intercambio con Enterprise Architect 15: 75 comprobaciones. No necesita EA.
# Importa un volcado del Diagramas.eapx REAL (leido con mdbtools) y verifica el
# ida y vuelta, incluida la direccion de la composicion y que los scripts sean
# JScript valido para el motor de EA.
cd uml-board && npx tsx pruebas/test-ea.ts

# Importacion por foto, cola offline tras recargar, y el asistente de voz movil.
# Requiere el simulador, el servidor y el frontend en marcha (npm i -D playwright).
node test-comprobacion3.mjs
```

### Coherencia entre el backend generado y el diseño de datos

El generador de backend y el de la colección de Postman derivan del **mismo**
mapeo objeto-relacional que produce el DDL (`utils/backendModel.ts` consume
`utils/dataDesign.ts`). Eso garantiza que las columnas, el lado en que va cada
clave foránea y la regla de borrado sean idénticos en el esquema documentado y
en el código Java. Antes cada generador interpretaba las relaciones por su
cuenta y las tres cosas divergían.
