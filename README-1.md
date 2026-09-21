# Intercambio con Enterprise Architect 15

Carpeta de scripts para Sparx Enterprise Architect **15.0.1514**, la herramienta
que el enunciado del parcial llama *Architech*.

## Por qué scripts y no un archivo `.eapx`

EA guarda el proyecto en un `.eapx`, que es una base de datos Access con el
esquema propio de EA (`t_object`, `t_connector`, `t_attribute`, `t_diagram`,
`t_diagramobjects`, y unas 90 tablas más). Escribir ese archivo desde el
navegador no es viable, y escribirlo a mano es la forma conocida de corromper un
proyecto. El intercambio va entonces por donde EA sí lo soporta oficialmente: su
motor de automatización (JScript en el Script Editor).

El mapeo no se adivinó: sale de leer un `.eapx` real generado por EA 15
(`t_connector`, `t_attribute`) y está verificado con 64 comprobaciones en
`uml-board/pruebas/test-ea.ts`, que importa el volcado de ese archivo real.

## Los tres scripts

| Archivo | Dirección | Qué hace |
| --- | --- | --- |
| `EA-CrearDocumentacion.js` | CASE → EA | Arma **toda** la estructura del documento: el árbol PUDS, los 10 casos de uso, el modelo conceptual, las clases dinámicas y los diagramas de secuencia. **41 diagramas.** |
| `EA-ModeloDeDatos.js` | CASE → EA | Solo el modelo conceptual (8 clases con sus atributos y relaciones) en un diagrama de clases. |
| `ExportarDesdeEA.js` | EA → CASE | Vuelca un paquete de EA a JSON para importarlo en la herramienta. |

## Cómo correrlos

1. Abrí tu proyecto en EA (`Diagramas.eapx`).
2. `Specialize` > `Tools` > `Scripting`.
3. Clic derecho en un grupo de scripts > `New JScript`.
4. Pegá el contenido del archivo y dale `Run` (o F5).
5. La salida va a la ventana `Script` (`Output`), con el detalle de lo que creó.

Los scripts son **idempotentes**: buscan por nombre antes de crear, así que
correrlos dos veces no duplica nada. Podés correr `EA-CrearDocumentacion.js`,
ajustar nombres a mano en EA, y volver a correrlo sin perder los cambios.

## Qué crea `EA-CrearDocumentacion.js`

```
Herramienta CASE Colaborativa
├── 1. Requisitos
│   ├── Casos de Uso            10 diagramas Use Case (actor + frontera + CU)
│   └── Diagrama General        1 diagrama con los 10 CU
├── 2. Analisis
│   ├── Colaboracion            diagrama Package + Encapsulamiento
│   ├── Modelado UML            diagrama Package + Encapsulamiento
│   └── Inteligencia Artificial diagrama Package + Encapsulamiento
└── 3. Diseno
    ├── 3.1 Arquitectura Logica un paquete y un diagrama Package por módulo
    ├── 3.2 Modelo de Datos     Diseno Conceptual (8 clases)
    ├── 3.4 Clases Dinamicas    10 diagramas Logical (boundary/control/entity)
    └── 3.5 Secuencia           10 diagramas Sequence con mensajes numerados
```

Después, para el documento: `Publish` > `Documentation` > `Generate
Documentation`.

## El punto delicado del mapeo: composición

En este proyecto una composición va del **todo** (source) a la **parte**
(target) — `dataDesign.ts` marca al target como entidad débil. EA la guarda al
revés: el conector arranca en la parte y el rombo queda en el extremo
*Supplier*, que es el todo. Se ve tal cual en el `.eapx` de referencia:

```
Aggregation  DetalleRutina -> Rutina   DestIsAggregate = 2   1..*  /  1..1
```

Si no se invierte, EA dibuja el rombo en la clase equivocada y el modelo queda
diciendo otra cosa. Los dos sentidos están cubiertos por los tests.

## Una pérdida conocida del ida y vuelta

El modelo interno guarda solo `1` o `*`, no el límite inferior. Entonces:

- una **composición** vuelve exacta (`1..*` del lado de la parte, porque en una
  composición la parte no existe sin el todo: el mínimo es 1);
- una **asociación común** que en EA era `1..*` vuelve como `0..*`.

Está anotado también dentro del script generado, para que no sorprenda.

## Limitaciones del motor de EA

El Script Editor de EA 15 corre **JScript 5.8**, no JavaScript moderno. Los
scripts no usan `let`, `const`, arrow functions, template literals ni `for..of`,
y **no** usan el objeto `JSON` (que no existe ahí): por eso `ExportarDesdeEA.js`
serializa a mano. Si vas a editarlos, respetá eso — los tests lo verifican.
