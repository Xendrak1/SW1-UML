import {
  SCRIPT_EXPORTAR_DESDE_EA,
  exportarXmiEa,
  generarScriptDocumentacionEa,
  generarScriptEa,
  importarDumpEa,
} from './enterpriseArchitect';
import { v4 as uuidv4 } from 'uuid';
import type { AttributeType, EdgeType, NodeType } from './umlConstants';

export { SCRIPT_EXPORTAR_DESDE_EA };

/**
 * INTEROPERABILIDAD CON OTRAS HERRAMIENTAS CASE
 *
 * Tres formatos, todos operativos:
 *   - JSON propio de esta herramienta, sin perdida de informacion.
 *   - XMI 2.5 (OMG), el intercambio estandar de UML.
 *   - Enterprise Architect 15, que es la herramienta que el enunciado llama
 *     "Architech": ida y vuelta por el motor de automatizacion de EA.
 *     Ver enterpriseArchitect.ts, que explica por que no se escribe el .eapx
 *     directamente.
 *
 * El registro ADAPTADORES es lo unico que mira la interfaz: agregar un formato
 * nuevo no toca ni el editor ni la barra de herramientas.
 */

export interface DiagramaPlano {
  nodes: NodeType[];
  edges: EdgeType[];
}

export interface AdaptadorCase {
  id: string;
  nombre: string;
  extension: string;
  mimeType: string;
  /** Indica si el adaptador esta operativo. Si es false, la UI lo muestra deshabilitado. */
  disponible: boolean;
  exportar: (d: DiagramaPlano) => string;
  importar: (contenido: string) => DiagramaPlano;
}

// ------------------------------------------------------------------ XMI 2.5

const XMI_TIPOS: Record<string, string> = {
  String: 'String',
  Integer: 'Integer',
  Float: 'Real',
  Boolean: 'Boolean',
  Date: 'String',
};

const XMI_TIPOS_INVERSO: Record<string, AttributeType['datatype']> = {
  String: 'String',
  Integer: 'Integer',
  Real: 'Float',
  Boolean: 'Boolean',
};

const escapar = (texto: string): string =>
  texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Los tipos de relacion UML no tienen todos el mismo elemento XMI. */
const esAsociacion = (tipo: EdgeType['tipo']) => tipo !== 'herencia' && tipo !== 'dependencia';

function exportarXmi({ nodes, edges }: DiagramaPlano): string {
  const lineas: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmi:XMI xmi:version="2.5.1"',
    '         xmlns:xmi="http://www.omg.org/spec/XMI/20131001"',
    '         xmlns:uml="http://www.omg.org/spec/UML/20131001">',
    '  <uml:Model xmi:type="uml:Model" xmi:id="modelo_1" name="DiagramaDeClases">',
  ];

  for (const n of nodes) {
    lineas.push(
      `    <packagedElement xmi:type="uml:Class" xmi:id="${n.id}" name="${escapar(n.label)}">`
    );
    // La posicion en el lienzo no es parte de UML: se conserva como anotacion
    // para no perder el acomodo al ir y volver entre herramientas.
    lineas.push(
      `      <eAnnotations xmi:type="ecore:EAnnotation" source="layout" references="x=${Math.round(n.x)};y=${Math.round(n.y)};asociativa=${Boolean(n.asociativa)}"/>`
    );
    for (const a of n.attributes ?? []) {
      lineas.push(
        `      <ownedAttribute xmi:type="uml:Property" xmi:id="${n.id}_${a.name}" name="${escapar(a.name)}" visibility="${a.scope}">`,
        `        <type xmi:type="uml:PrimitiveType" href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#${XMI_TIPOS[a.datatype] ?? 'String'}"/>`,
        '      </ownedAttribute>'
      );
    }
    lineas.push('    </packagedElement>');
  }

  for (const e of edges) {
    if (e.tipo === 'herencia') {
      // La generalizacion es un elemento hijo de la clase hija, no un elemento suelto.
      continue;
    }
    if (esAsociacion(e.tipo)) {
      const agregacion =
        e.tipo === 'composicion' ? 'composite' : e.tipo === 'agregacion' ? 'shared' : 'none';
      lineas.push(
        `    <packagedElement xmi:type="uml:Association" xmi:id="${e.id}" name="${escapar(e.tipo)}">`,
        `      <ownedEnd xmi:type="uml:Property" xmi:id="${e.id}_src" type="${e.source}" aggregation="${agregacion}">`,
        `        <lowerValue xmi:type="uml:LiteralInteger" value="${e.multiplicidadOrigen === '*' ? '0' : '1'}"/>`,
        `        <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="${e.multiplicidadOrigen}"/>`,
        '      </ownedEnd>',
        `      <ownedEnd xmi:type="uml:Property" xmi:id="${e.id}_tgt" type="${e.target}">`,
        `        <lowerValue xmi:type="uml:LiteralInteger" value="${e.multiplicidadDestino === '*' ? '0' : '1'}"/>`,
        `        <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="${e.multiplicidadDestino}"/>`,
        '      </ownedEnd>',
        '    </packagedElement>'
      );
    } else {
      lineas.push(
        `    <packagedElement xmi:type="uml:Dependency" xmi:id="${e.id}" client="${e.source}" supplier="${e.target}"/>`
      );
    }
  }

  // Las generalizaciones se emiten dentro de sus clases hijas.
  const herencias = edges.filter(e => e.tipo === 'herencia');
  if (herencias.length > 0) {
    lineas.push('    <!-- Generalizaciones -->');
    for (const h of herencias) {
      lineas.push(
        `    <packagedElement xmi:type="uml:Class" xmi:id="${h.source}_gen_holder" name="__generalization__">`,
        `      <generalization xmi:type="uml:Generalization" xmi:id="${h.id}" general="${h.target}" specific="${h.source}"/>`,
        '    </packagedElement>'
      );
    }
  }

  lineas.push('  </uml:Model>', '</xmi:XMI>');
  return lineas.join('\n');
}

function importarXmi(contenido: string): DiagramaPlano {
  const doc = new DOMParser().parseFromString(contenido, 'text/xml');
  const errores = doc.getElementsByTagName('parsererror');
  if (errores.length > 0) throw new Error('El archivo XMI no es XML valido');

  const nodes: NodeType[] = [];
  const edges: EdgeType[] = [];
  const idsValidos = new Set<string>();

  const elementos = [...doc.getElementsByTagName('packagedElement')];

  // Primera pasada: las clases.
  elementos.forEach((el, index) => {
    if (el.getAttribute('xmi:type') !== 'uml:Class') return;
    const name = el.getAttribute('name') ?? `Clase${index + 1}`;
    if (name === '__generalization__') return;
    const id = el.getAttribute('xmi:id') ?? uuidv4();

    // Recuperamos la posicion de la anotacion de layout, si el archivo la trae.
    let x = 80 + (index % 4) * 320;
    let y = 80 + Math.floor(index / 4) * 260;
    let asociativa = false;
    const anotacion = [...el.getElementsByTagName('eAnnotations')].find(
      a => a.getAttribute('source') === 'layout'
    );
    if (anotacion) {
      const refs = anotacion.getAttribute('references') ?? '';
      const mx = /x=(-?\d+)/.exec(refs);
      const my = /y=(-?\d+)/.exec(refs);
      if (mx) x = Number(mx[1]);
      if (my) y = Number(my[1]);
      asociativa = /asociativa=true/.test(refs);
    }

    const attributes: AttributeType[] = [...el.getElementsByTagName('ownedAttribute')].map(attr => {
      const href = attr.getElementsByTagName('type')[0]?.getAttribute('href') ?? '';
      const tipoXmi = href.split('#')[1] ?? 'String';
      const visibility = attr.getAttribute('visibility') ?? 'private';
      return {
        name: attr.getAttribute('name') ?? 'campo',
        datatype: XMI_TIPOS_INVERSO[tipoXmi] ?? 'String',
        scope: (['public', 'private', 'protected'] as const).includes(visibility as never)
          ? (visibility as AttributeType['scope'])
          : 'private',
      };
    });

    idsValidos.add(id);
    nodes.push({ id, label: name, x, y, attributes, asociativa });
  });

  // Segunda pasada: asociaciones, dependencias y generalizaciones.
  for (const el of elementos) {
    const tipo = el.getAttribute('xmi:type');

    if (tipo === 'uml:Association') {
      const ends = [...el.getElementsByTagName('ownedEnd')];
      const source = ends[0]?.getAttribute('type');
      const target = ends[1]?.getAttribute('type');
      if (!source || !target || !idsValidos.has(source) || !idsValidos.has(target)) continue;
      const agregacion = ends[0]?.getAttribute('aggregation');
      edges.push({
        id: el.getAttribute('xmi:id') ?? `e_${uuidv4()}`,
        source,
        target,
        tipo:
          agregacion === 'composite'
            ? 'composicion'
            : agregacion === 'shared'
              ? 'agregacion'
              : 'asociacion',
        multiplicidadOrigen:
          ends[0]?.getElementsByTagName('upperValue')[0]?.getAttribute('value') === '*' ? '*' : '1',
        multiplicidadDestino:
          ends[1]?.getElementsByTagName('upperValue')[0]?.getAttribute('value') === '*' ? '*' : '1',
      });
    }

    if (tipo === 'uml:Dependency') {
      const source = el.getAttribute('client');
      const target = el.getAttribute('supplier');
      if (!source || !target || !idsValidos.has(source) || !idsValidos.has(target)) continue;
      edges.push({
        id: el.getAttribute('xmi:id') ?? `e_${uuidv4()}`,
        source,
        target,
        tipo: 'dependencia',
        multiplicidadOrigen: '1',
        multiplicidadDestino: '1',
      });
    }
  }

  for (const gen of [...doc.getElementsByTagName('generalization')]) {
    const source = gen.getAttribute('specific');
    const target = gen.getAttribute('general');
    if (!source || !target || !idsValidos.has(source) || !idsValidos.has(target)) continue;
    edges.push({
      id: gen.getAttribute('xmi:id') ?? `e_${uuidv4()}`,
      source,
      target,
      tipo: 'herencia',
      multiplicidadOrigen: '1',
      multiplicidadDestino: '1',
    });
  }

  if (nodes.length === 0) throw new Error('El archivo XMI no contiene clases reconocibles');
  return { nodes, edges };
}

export const adaptadorXmi: AdaptadorCase = {
  id: 'xmi',
  nombre: 'XMI 2.5 (estandar OMG)',
  extension: '.xmi',
  mimeType: 'application/xml',
  disponible: true,
  exportar: exportarXmi,
  importar: importarXmi,
};

// ------------------------------------------- Enterprise Architect ("Architech")

/**
 * Enterprise Architect 15, en la direccion CASE -> EA.
 *
 * Lo que se descarga es un JScript para el Script Editor de EA, no un .eapx:
 * el motivo esta explicado en enterpriseArchitect.ts.
 */
export const adaptadorEa: AdaptadorCase = {
  id: 'ea',
  nombre: 'Enterprise Architect 15 (script del modelo)',
  extension: '.js',
  mimeType: 'text/javascript',
  disponible: true,
  exportar: d => generarScriptEa(d),
  importar: () => {
    throw new Error(
      'Para traer un modelo desde Enterprise Architect corre primero el script de ' +
        'exportacion en EA (Intercambio > Script para exportar desde EA) e importa el ' +
        'JSON que deja en C:\\Temp\\modelo-ea.json.'
    );
  },
};

/**
 * Enterprise Architect 15 por XMI 2.1: el camino sin scripts.
 * En EA: Project > Model Import/Export > Import Package from XMI.
 */
export const adaptadorEaXmi: AdaptadorCase = {
  id: 'ea-xmi',
  nombre: 'Enterprise Architect 15 (XMI 2.1, se importa desde el menu)',
  extension: '.xml',
  mimeType: 'application/xml',
  disponible: true,
  exportar: d => exportarXmiEa(d),
  // La importacion de un .xml la resuelve el adaptador XMI generico.
  importar: importarXmi,
};

/** Enterprise Architect 15: toda la estructura del documento, no solo el modelo. */
export const adaptadorEaDocumento: AdaptadorCase = {
  id: 'ea-doc',
  nombre: 'Enterprise Architect 15 (estructura del documento)',
  extension: '.js',
  mimeType: 'text/javascript',
  disponible: true,
  exportar: d => generarScriptDocumentacionEa(d),
  importar: () => {
    throw new Error('Este formato solo genera la estructura en EA; no se importa.');
  },
};

// ------------------------------------------------------------------ registro

/** Formato propio de la herramienta, sin perdida de informacion. */
export const adaptadorJson: AdaptadorCase = {
  id: 'json',
  nombre: 'JSON nativo de esta herramienta',
  extension: '.json',
  mimeType: 'application/json',
  disponible: true,
  exportar: d => JSON.stringify({ nodes: d.nodes, edges: d.edges }, null, 2),
  importar: contenido => {
    const data = JSON.parse(contenido);
    // El volcado de Enterprise Architect tambien es un .json, asi que se
    // reconoce por su contenido en vez de obligar a elegir el formato a mano.
    if (Array.isArray(data.clases)) return importarDumpEa(contenido);
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      throw new Error(
        'El JSON debe tener los arreglos "nodes" y "edges", o "clases" si viene de Enterprise Architect'
      );
    }
    return { nodes: data.nodes, edges: data.edges };
  },
};

export const ADAPTADORES: AdaptadorCase[] = [
  adaptadorJson,
  adaptadorXmi,
  adaptadorEaXmi,
  adaptadorEa,
  adaptadorEaDocumento,
];

export const buscarAdaptador = (id: string): AdaptadorCase | undefined =>
  ADAPTADORES.find(a => a.id === id);
