import { v4 as uuidv4 } from 'uuid';
import { umlToFlowEdges, umlToFlowNodes } from '../lib/flowToUml';
import { useClassStore } from '../store/classStore';
import type { AttributeType, EdgeType, NodeType } from '../utils/umlConstants';
import type { DiagramAction } from './aiPromptService';

/**
 * Ejecuta las acciones que devuelve el asistente de IA sobre el diagrama.
 *
 * Se aplican como operaciones granulares del store, no reemplazando el documento,
 * asi que una instruccion dictada por voz mientras otra persona edita otra clase
 * no le pisa el trabajo.
 *
 * Devuelve un resumen en lenguaje natural, que la app movil lee en voz alta
 * (es su unica salida, porque no tiene interfaz grafica).
 */

const SCOPES = ['public', 'private', 'protected'] as const;
const DATATYPES = ['Integer', 'Float', 'Boolean', 'Date', 'String'] as const;
const TIPOS = ['asociacion', 'agregacion', 'composicion', 'herencia', 'dependencia'] as const;

const scope = (v: unknown): AttributeType['scope'] =>
  SCOPES.includes(v as never) ? (v as AttributeType['scope']) : 'private';
const datatype = (v: unknown): AttributeType['datatype'] =>
  DATATYPES.includes(v as never) ? (v as AttributeType['datatype']) : 'String';
const tipoRel = (v: unknown): EdgeType['tipo'] =>
  TIPOS.includes(v as never) ? (v as EdgeType['tipo']) : 'asociacion';
const mult = (v: unknown): '1' | '*' => (String(v ?? '1') === '*' ? '*' : '1');

/** Ubica una clase nueva en un hueco libre, para que no caiga encima de otra. */
function posicionLibre(existentes: NodeType[]): { x: number; y: number } {
  const ocupadas = new Set(existentes.map(n => `${Math.round(n.x / 320)},${Math.round(n.y / 260)}`));
  for (let fila = 0; fila < 20; fila += 1) {
    for (let col = 0; col < 5; col += 1) {
      if (!ocupadas.has(`${col},${fila}`)) return { x: 80 + col * 320, y: 80 + fila * 260 };
    }
  }
  return { x: 80, y: 80 };
}

export interface ResultadoAcciones {
  resumen: string;
  aplicadas: number;
  omitidas: string[];
}

export async function aplicarAccionesIA(
  actions: DiagramAction[],
  nodesActuales: NodeType[],
  edgesActuales: EdgeType[]
): Promise<ResultadoAcciones> {
  const store = useClassStore.getState();

  // Trabajamos sobre una copia local para poder resolver referencias entre
  // acciones del mismo lote (una relacion que menciona una clase recien creada).
  let nodes = [...nodesActuales];
  const edges = [...edgesActuales];

  const nuevosNodes: NodeType[] = [];
  const nuevosEdges: EdgeType[] = [];
  const omitidas: string[] = [];
  const hechos: string[] = [];
  let aplicadas = 0;

  const buscarPorNombre = (label: string | undefined): NodeType | undefined => {
    if (!label) return undefined;
    const objetivo = label.trim().toLowerCase();
    return nodes.find(n => n.label.trim().toLowerCase() === objetivo);
  };

  const buscarPorIdONombre = (ref: string | undefined): NodeType | undefined =>
    nodes.find(n => n.id === ref) ?? buscarPorNombre(ref);

  for (const action of actions) {
    const data = action.data ?? {};

    // ---- clases ----
    if (action.target === 'class' && action.type === 'create') {
      if (!data.label) {
        omitidas.push('una clase sin nombre');
        continue;
      }
      if (buscarPorNombre(data.label)) {
        omitidas.push(`la clase ${data.label} ya existía`);
        continue;
      }
      const { x, y } = posicionLibre(nodes);

      // La IA devuelve los extremos de una clase asociativa por NOMBRE; el editor
      // y el generador de backend los necesitan por id. Sin esta resolución, la
      // clase asociativa existe pero no puede producir su tabla intermedia.
      let asociativa = Boolean(data.asociativa);
      let relaciona: [string, string] | undefined;
      if (asociativa && Array.isArray(data.relaciona) && data.relaciona.length === 2) {
        const extremoA = buscarPorIdONombre(String(data.relaciona[0]));
        const extremoB = buscarPorIdONombre(String(data.relaciona[1]));
        if (extremoA && extremoB && extremoA.id !== extremoB.id) {
          relaciona = [extremoA.id, extremoB.id];
        } else {
          // Sin los dos extremos no es una clase asociativa válida: se crea como
          // clase normal en vez de dejar un nodo a medio formar en el documento.
          asociativa = false;
          omitidas.push(
            `${data.label}: no encontré las clases ${data.relaciona.join(' y ')}, la creé como clase normal`
          );
        }
      } else if (asociativa) {
        asociativa = false;
        omitidas.push(`${data.label}: clase asociativa sin sus dos extremos, la creé como clase normal`);
      }

      const nuevo: NodeType = {
        id: uuidv4(),
        label: String(data.label).trim(),
        x,
        y,
        attributes: (data.attributes ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((a: any) => a?.name && String(a.name).toLowerCase() !== 'id')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((a: any) => ({
            name: String(a.name).trim(),
            datatype: datatype(a.datatype),
            scope: scope(a.scope),
          })),
        asociativa,
        ...(relaciona ? { relaciona } : {}),
      };
      nodes = [...nodes, nuevo];
      nuevosNodes.push(nuevo);
      aplicadas += 1;
      hechos.push(`creé la clase ${nuevo.label}`);
      continue;
    }

    if (action.target === 'class' && action.type === 'update') {
      const objetivo = buscarPorIdONombre(data.id ?? data.label);
      if (!objetivo) {
        omitidas.push(`no encontré la clase ${data.id ?? data.label ?? '(sin referencia)'}`);
        continue;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patch: any = {};
      if (data.label) patch.label = String(data.label).trim();
      if (Array.isArray(data.attributes)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        patch.attributes = data.attributes.map((a: any, i: number) => ({
          id: `${objetivo.id}_a${i}`,
          name: String(a.name).trim(),
          type: datatype(a.datatype ?? a.type),
          scope: scope(a.scope),
        }));
      }
      store.updateNode(objetivo.id, patch);
      nodes = nodes.map(n =>
        n.id === objetivo.id
          ? {
              ...n,
              label: patch.label ?? n.label,
              attributes: data.attributes
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  data.attributes.map((a: any) => ({
                    name: String(a.name).trim(),
                    datatype: datatype(a.datatype ?? a.type),
                    scope: scope(a.scope),
                  }))
                : n.attributes,
            }
          : n
      );
      aplicadas += 1;
      hechos.push(`actualicé la clase ${patch.label ?? objetivo.label}`);
      continue;
    }

    if (action.target === 'class' && action.type === 'delete') {
      const objetivo = buscarPorIdONombre(data.id ?? data.label);
      if (!objetivo) {
        omitidas.push(`no encontré la clase a eliminar`);
        continue;
      }
      store.onNodesChange([{ id: objetivo.id, type: 'remove' }]);
      nodes = nodes.filter(n => n.id !== objetivo.id);
      aplicadas += 1;
      hechos.push(`eliminé la clase ${objetivo.label}`);
      continue;
    }

    // ---- atributos ----
    if (action.target === 'attribute' && action.type === 'create') {
      const objetivo = buscarPorIdONombre(data.classId ?? data.label);
      if (!objetivo) {
        omitidas.push(`no encontré la clase para el atributo ${data.name ?? ''}`);
        continue;
      }
      if (!data.name) {
        omitidas.push('un atributo sin nombre');
        continue;
      }
      const existentes = objetivo.attributes ?? [];
      if (existentes.some(a => a.name.toLowerCase() === String(data.name).toLowerCase())) {
        omitidas.push(`${objetivo.label} ya tenía el atributo ${data.name}`);
        continue;
      }
      const nuevos = [
        ...existentes,
        {
          name: String(data.name).trim(),
          datatype: datatype(data.datatype),
          scope: scope(data.scope),
        },
      ];
      store.updateNode(objetivo.id, {
        attributes: nuevos.map((a, i) => ({
          id: `${objetivo.id}_a${i}`,
          name: a.name,
          type: a.datatype,
          scope: a.scope,
        })),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      nodes = nodes.map(n => (n.id === objetivo.id ? { ...n, attributes: nuevos } : n));
      aplicadas += 1;
      hechos.push(`agregué ${data.name} a ${objetivo.label}`);
      continue;
    }

    // ---- relaciones ----
    if (action.target === 'edge' && action.type === 'create') {
      const origen = buscarPorIdONombre(data.sourceLabel ?? data.source);
      const destino = buscarPorIdONombre(data.targetLabel ?? data.target);
      if (!origen || !destino) {
        omitidas.push(
          `no pude relacionar ${data.sourceLabel ?? '?'} con ${data.targetLabel ?? '?'}: falta una de las clases`
        );
        continue;
      }
      if (origen.id === destino.id) {
        omitidas.push('una relación de una clase consigo misma');
        continue;
      }
      const tipo = tipoRel(data.tipo);
      const yaEsta = [...edges, ...nuevosEdges].some(
        e => e.source === origen.id && e.target === destino.id && e.tipo === tipo
      );
      if (yaEsta) {
        omitidas.push(`la relación ${origen.label}-${destino.label} ya existía`);
        continue;
      }
      const nuevo: EdgeType = {
        id: `e_${uuidv4()}`,
        source: origen.id,
        target: destino.id,
        tipo,
        multiplicidadOrigen: mult(data.multiplicidadOrigen),
        multiplicidadDestino: mult(data.multiplicidadDestino),
      };
      nuevosEdges.push(nuevo);
      edges.push(nuevo);
      aplicadas += 1;
      hechos.push(`relacioné ${origen.label} con ${destino.label} por ${tipo}`);
      continue;
    }

    if (action.target === 'edge' && action.type === 'delete') {
      const objetivo = edges.find(e => e.id === data.id);
      if (!objetivo) {
        omitidas.push('no encontré la relación a eliminar');
        continue;
      }
      store.onEdgesChange([{ id: objetivo.id, type: 'remove' }]);
      aplicadas += 1;
      hechos.push('eliminé una relación');
      continue;
    }

    omitidas.push(`acción no reconocida: ${action.type} ${action.target}`);
  }

  // Las clases se agregan antes que las relaciones: el servidor rechaza una arista
  // cuyos extremos todavia no existen en el documento.
  if (nuevosNodes.length > 0) {
    store.onNodesChange(
      umlToFlowNodes(nuevosNodes).map(n => ({ type: 'add' as const, item: n }))
    );
  }
  if (nuevosEdges.length > 0) {
    store.onEdgesChange(
      umlToFlowEdges(nuevosEdges).map(e => ({ type: 'add' as const, item: e }))
    );
  }

  const resumen =
    aplicadas === 0
      ? omitidas.length > 0
        ? `No pude aplicar nada. ${omitidas[0]}.`
        : 'No entendí ningún cambio para el diagrama.'
      : `Listo: ${hechos.join('; ')}.${omitidas.length > 0 ? ` Omití ${omitidas.length}: ${omitidas[0]}.` : ''}`;

  return { resumen, aplicadas, omitidas };
}
