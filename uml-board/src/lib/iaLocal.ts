import type { DiagramAction } from '../services/aiPromptService';
import type { EdgeType, NodeType } from '../utils/umlConstants';

/**
 * INTERPRETE DE INSTRUCCIONES QUE CORRE EN EL DISPOSITIVO
 *
 * El enunciado es explicito con la app movil: "la IA que utilizaremos para esa
 * app movil debe funcionar asi no haya internet, tanto al nivel de datos y al
 * nivel de interaccion con la IA, que la IA debe estar en el celular".
 *
 * Los datos ya funcionaban sin red (cola de operaciones en IndexedDB) y el
 * reconocimiento de voz tambien (Web Speech API del sistema operativo), pero la
 * INTERPRETACION viajaba al servidor: sin red, el asistente escuchaba y no
 * entendia nada. Esto lo resuelve.
 *
 * QUE ES Y QUE NO ES, para no venderlo de mas: es un interprete por gramatica,
 * deterministico, que cubre las instrucciones de modelado que se usan de verdad
 * (crear una clase con atributos, agregar un atributo, relacionar, heredar,
 * muchos a muchos, borrar, renombrar). NO es una red neuronal: un modelo de 7B
 * no entra en un telefono y bajarlo por WebGPU son cientos de megas que no
 * sobreviven a una demostracion. Cuando hay red se usa el modelo completo del
 * servidor, que entiende lenguaje libre; sin red entra este, que entiende las
 * ordenes frecuentes y lo dice cuando no entiende.
 *
 * Devuelve la MISMA forma que el endpoint del servidor -DiagramAction[]-, asi
 * que el resto del flujo (validar, aplicar, sincronizar) es identico por los
 * dos caminos y no hay una segunda implementacion que pueda divergir.
 */

/** Palabras con las que la gente dicta un tipo de dato. */
const TIPOS: Array<[RegExp, string]> = [
  [/\b(texto|cadena|string|caracteres|nombre completo)\b/, 'String'],
  [/\b(entero|numero entero|int|integer|cantidad|edad)\b/, 'Integer'],
  [/\b(decimal|flotante|real|float|double|precio|monto|importe)\b/, 'Float'],
  [/\b(booleano|logico|si o no|verdadero o falso|bool)\b/, 'Boolean'],
  [/\b(fecha|date|dia|timestamp)\b/, 'Date'],
];

const TIPO_POR_DEFECTO = 'String';

/** Quita acentos y normaliza espacios, para que las expresiones sean simples. */
const norm = (t: string): string =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const tipoDe = (texto: string): string => {
  const t = norm(texto);
  for (const [re, tipo] of TIPOS) if (re.test(t)) return tipo;
  return TIPO_POR_DEFECTO;
};

/** PascalCase para nombres de clase; el dictado llega todo en minusculas. */
const aPascal = (t: string): string =>
  t
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

/** camelCase para nombres de atributo. */
const aCamel = (t: string): string => {
  const p = aPascal(t);
  return p.charAt(0).toLowerCase() + p.slice(1);
};

/**
 * Palabras que el dictado suele pegar al nombre y que no son parte de el.
 * Sin esto, "crea una clase Mascota" termina creando la clase "UnaMascota".
 */
const RUIDO =
  /^(la |el |una |un |las |los |clase |tabla |entidad |nueva |nuevo |llamada |llamado |de |del )+/;

const limpiarNombre = (t: string): string => norm(t).replace(RUIDO, '').replace(/[.,;:!?]+$/, '').trim();

/** Busca una clase existente por nombre, tolerando acentos y mayusculas. */
function buscarClase(nodes: NodeType[], nombre: string): NodeType | undefined {
  const n = norm(limpiarNombre(nombre));
  if (n === '') return undefined;
  return (
    nodes.find(x => norm(x.label) === n) ??
    // Coincidencia por prefijo: el dictado corta palabras a veces.
    nodes.find(x => norm(x.label).startsWith(n) || n.startsWith(norm(x.label)))
  );
}

export interface ResultadoLocal {
  actions: DiagramAction[];
  /** Lo que el interprete entendio, para decirlo por voz. */
  entendido: string;
  /** false cuando no reconocio la instruccion: ahi conviene avisar, no inventar. */
  reconocido: boolean;
}

const nada = (motivo: string): ResultadoLocal => ({ actions: [], entendido: motivo, reconocido: false });

/**
 * Separa la lista de atributos dictada: "nombre texto y edad entero",
 * "nombre texto, edad entero y peso decimal".
 */
function leerAtributos(texto: string, clase: string): DiagramAction[] {
  const partes = norm(texto)
    .replace(/\by\b/g, ',')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  const acciones: DiagramAction[] = [];
  const vistos = new Set<string>();
  for (const parte of partes) {
    // "precio decimal" -> nombre "precio", tipo Float. La ultima palabra suele
    // ser el tipo; si no lo es, el atributo es String.
    const palabras = parte.split(' ').filter(Boolean);
    if (palabras.length === 0) continue;
    const ultima = palabras[palabras.length - 1];
    const esTipo = TIPOS.some(([re]) => re.test(ultima));
    const nombreBruto = esTipo ? palabras.slice(0, -1).join(' ') : parte;
    const nombre = aCamel(nombreBruto);
    if (nombre === '' || nombre === 'id' || vistos.has(nombre)) continue;
    vistos.add(nombre);
    acciones.push({
      type: 'create',
      target: 'attribute',
      data: { classId: clase, name: nombre, datatype: esTipo ? tipoDe(ultima) : TIPO_POR_DEFECTO, scope: 'private' },
    });
  }
  return acciones;
}

const mult = (texto: string): { origen: '1' | '*'; destino: '1' | '*' } => {
  const t = norm(texto);
  if (/\bmuchos a muchos\b|\bn a n\b|\bvarios a varios\b/.test(t)) return { origen: '*', destino: '*' };
  if (/\buno a muchos\b|\b1 a muchos\b|\buno a varios\b|\b1 a n\b/.test(t)) return { origen: '1', destino: '*' };
  if (/\bmuchos a uno\b|\bn a 1\b/.test(t)) return { origen: '*', destino: '1' };
  if (/\buno a uno\b|\b1 a 1\b/.test(t)) return { origen: '1', destino: '1' };
  return { origen: '1', destino: '*' };
};

/**
 * Interpreta una instruccion dictada. El orden de las reglas importa: las mas
 * especificas van primero, porque "muchos a muchos entre A y B" tambien
 * encajaria en la regla generica de relacionar.
 */
export function interpretarLocal(
  instruccion: string,
  nodes: NodeType[],
  edges: EdgeType[]
): ResultadoLocal {
  const t = norm(instruccion);
  if (t === '') return nada('No escuche nada.');

  // ---- muchos a muchos: se resuelve con clase asociativa ----
  const mn = /(?:muchos a muchos|n a n)\s*(?:entre|de)?\s*(.+?)\s+(?:y|con)\s+(.+)$/.exec(t);
  if (mn) {
    const a = buscarClase(nodes, mn[1]);
    const b = buscarClase(nodes, mn[2]);
    if (!a || !b) {
      return nada(
        `Para una relacion muchos a muchos necesito que las dos clases existan. No encontre ${
          !a ? aPascal(limpiarNombre(mn[1])) : aPascal(limpiarNombre(mn[2]))
        }.`
      );
    }
    const intermedia = `${a.label}${b.label}`;
    return {
      reconocido: true,
      entendido: `Muchos a muchos entre ${a.label} y ${b.label}, con la clase asociativa ${intermedia}.`,
      actions: [
        {
          type: 'create',
          target: 'class',
          data: { label: intermedia, asociativa: true, relaciona: [a.label, b.label], attributes: [] },
        },
        {
          type: 'create',
          target: 'edge',
          data: { sourceLabel: a.label, targetLabel: intermedia, tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
        },
        {
          type: 'create',
          target: 'edge',
          data: { sourceLabel: b.label, targetLabel: intermedia, tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
        },
      ],
    };
  }

  // ---- herencia ----
  const her = /(.+?)\s+(?:hereda de|extiende de|extiende|es un tipo de|es una|especializa)\s+(.+)$/.exec(t);
  if (her) {
    const hija = buscarClase(nodes, her[1]);
    const padre = buscarClase(nodes, her[2]);
    if (!hija || !padre) return nada('Para la herencia necesito que las dos clases ya existan.');
    return {
      reconocido: true,
      entendido: `${hija.label} hereda de ${padre.label}.`,
      actions: [
        {
          type: 'create',
          target: 'edge',
          data: { sourceLabel: hija.label, targetLabel: padre.label, tipo: 'herencia', multiplicidadOrigen: '1', multiplicidadDestino: '1' },
        },
      ],
    };
  }

  // ---- composicion y agregacion ----
  const comp = /(.+?)\s+(?:se compone de|compone a|contiene a|esta compuesta por|esta compuesto por)\s+(.+)$/.exec(t);
  const agr = /(.+?)\s+(?:agrupa a|agrega a|tiene varios|tiene varias)\s+(.+)$/.exec(t);
  const ca = comp ?? agr;
  if (ca) {
    const todo = buscarClase(nodes, ca[1]);
    const parte = buscarClase(nodes, ca[2]);
    if (!todo || !parte) return nada('Para esa relacion necesito que las dos clases ya existan.');
    const tipo = comp ? 'composicion' : 'agregacion';
    const m = mult(t);
    return {
      reconocido: true,
      entendido: `${todo.label} ${comp ? 'se compone de' : 'agrupa a'} ${parte.label}.`,
      actions: [
        {
          type: 'create',
          target: 'edge',
          data: { sourceLabel: todo.label, targetLabel: parte.label, tipo, multiplicidadOrigen: m.origen, multiplicidadDestino: m.destino },
        },
      ],
    };
  }

  // ---- borrar ----
  const del = /^(?:borra|borrar|elimina|eliminar|quita|quitar|saca|sacar)\s+(?:la |el )?(?:clase |tabla |entidad )?(.+)$/.exec(t);
  if (del) {
    const c = buscarClase(nodes, del[1]);
    if (!c) return nada(`No encontre la clase ${aPascal(limpiarNombre(del[1]))} en el diagrama.`);
    return {
      reconocido: true,
      entendido: `Borre la clase ${c.label}.`,
      actions: [{ type: 'delete', target: 'class', data: { id: c.id, label: c.label } }],
    };
  }

  // ---- renombrar ----
  const ren = /^(?:renombra|renombrar|cambia el nombre de|cambiale el nombre a)\s+(.+?)\s+(?:a|por)\s+(.+)$/.exec(t);
  if (ren) {
    const c = buscarClase(nodes, ren[1]);
    if (!c) return nada(`No encontre la clase ${aPascal(limpiarNombre(ren[1]))}.`);
    const nuevo = aPascal(limpiarNombre(ren[2]));
    return {
      reconocido: true,
      entendido: `Renombre ${c.label} a ${nuevo}.`,
      actions: [{ type: 'update', target: 'class', data: { id: c.id, label: nuevo } }],
    };
  }

  // ---- agregar atributos a una clase existente ----
  const attr =
    /^(?:agrega|agregar|agregale|anade|anadir|sumale|pon|poner|mete)\s+(?:el |los |un |unos )?(?:atributo |atributos |campo |campos |propiedad )?(.+?)\s+(?:a|en|de)\s+(?:la |el )?(?:clase |tabla )?([^\s]+(?:\s+[^\s]+)?)$/.exec(t);
  if (attr) {
    const c = buscarClase(nodes, attr[2]);
    if (c) {
      const acciones = leerAtributos(attr[1], c.label);
      if (acciones.length === 0) return nada('Entendi la clase pero no el atributo.');
      return {
        reconocido: true,
        entendido: `Agregue ${acciones.length} atributo(s) a ${c.label}.`,
        actions: acciones,
      };
    }
  }

  // ---- crear clase, con o sin atributos ----
  const cls =
    /^(?:crea|crear|creame|nueva|nuevo|agrega|agregar|anade|hace|hacer|dame)\s+(?:una |un )?(?:clase |tabla |entidad )?(.+)$/.exec(t);
  if (cls) {
    const resto = cls[1];
    const conAttrs = /^(.+?)\s+(?:con|que tenga|con los atributos|con atributos)\s+(.+)$/.exec(resto);
    const nombreClase = aPascal(limpiarNombre(conAttrs ? conAttrs[1] : resto));
    if (nombreClase === '') return nada('No entendi el nombre de la clase.');
    if (buscarClase(nodes, nombreClase)) {
      return nada(`La clase ${nombreClase} ya existe en el diagrama.`);
    }
    const acciones: DiagramAction[] = [
      { type: 'create', target: 'class', data: { label: nombreClase, asociativa: false, attributes: [] } },
    ];
    if (conAttrs) acciones.push(...leerAtributos(conAttrs[2], nombreClase));
    return {
      reconocido: true,
      entendido:
        acciones.length > 1
          ? `Cree la clase ${nombreClase} con ${acciones.length - 1} atributo(s).`
          : `Cree la clase ${nombreClase}.`,
      actions: acciones,
    };
  }

  // ---- relacionar (va al final: es la regla mas generica) ----
  const rel =
    /(?:relaciona|relacionar|conecta|conectar|une|unir|vincula)?\s*(?:la clase |el )?(.+?)\s+(?:se relaciona con|con|y|a)\s+(.+?)(?:,|\s+)?(?:uno a muchos|muchos a uno|uno a uno|1 a n|n a 1|1 a 1)?$/.exec(t);
  if (rel && /relacion|relaciona|conecta|une|vincula/.test(t)) {
    const a = buscarClase(nodes, rel[1]);
    const b = buscarClase(nodes, rel[2]);
    if (!a || !b) return nada('Para relacionar necesito que las dos clases ya existan.');
    // Repetir una relacion que ya existe ensucia el diagrama y despues el DDL:
    // es mejor decirlo que dibujar dos lineas entre las mismas clases.
    const yaEsta = edges.some(
      e => (e.source === a.id && e.target === b.id) || (e.source === b.id && e.target === a.id)
    );
    if (yaEsta) {
      return nada(`${a.label} y ${b.label} ya estan relacionadas en el diagrama.`);
    }
    const m = mult(t);
    return {
      reconocido: true,
      entendido: `Relacione ${a.label} con ${b.label}, ${m.origen} a ${m.destino === '*' ? 'muchos' : 'uno'}.`,
      actions: [
        {
          type: 'create',
          target: 'edge',
          data: { sourceLabel: a.label, targetLabel: b.label, tipo: 'asociacion', multiplicidadOrigen: m.origen, multiplicidadDestino: m.destino },
        },
      ],
    };
  }

  return nada(
    'Sin conexion entiendo ordenes concretas. Por ejemplo: crea una clase Producto con nombre texto y precio decimal.'
  );
}
