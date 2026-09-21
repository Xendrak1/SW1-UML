import type { Edge, Node } from 'reactflow';
import type { AttributeType, EdgeType, NodeType } from '../utils/umlConstants';

/**
 * Convierte el estado del editor (ReactFlow) al modelo UML que consumen el generador
 * de backend, el modulo de diseno de datos y los adaptadores de interoperabilidad.
 * Estaba duplicado dentro de BoardPage; aqui queda en un solo lugar.
 */

const SCOPES = ['public', 'private', 'protected'] as const;
const DATATYPES = ['Integer', 'Float', 'Boolean', 'Date', 'String'] as const;

const scopeValido = (v: unknown): AttributeType['scope'] =>
  SCOPES.includes(v as never) ? (v as AttributeType['scope']) : 'private';

const datatypeValido = (v: unknown): AttributeType['datatype'] =>
  DATATYPES.includes(v as never) ? (v as AttributeType['datatype']) : 'String';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flowNodesToUml(nodes: Node<any>[]): NodeType[] {
  return nodes.map(n => ({
    id: n.id,
    label: n.data?.label ?? 'Class',
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attributes: (n.data?.attributes ?? []).map((a: any) => ({
      name: a.name,
      // El editor guarda el tipo en `type`; el modelo UML lo llama `datatype`.
      datatype: datatypeValido(a.datatype ?? a.type),
      scope: scopeValido(a.scope),
    })),
    asociativa: n.data?.asociativa ?? false,
    relaciona: n.data?.relaciona as [string, string] | undefined,
  }));
}

const multiplicidadValida = (v: unknown): '1' | '*' => {
  const s = String(v ?? '1');
  return s === '*' || s.includes('..') ? '*' : '1';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function flowEdgesToUml(edges: Edge<any>[]): EdgeType[] {
  const TIPOS = ['asociacion', 'agregacion', 'composicion', 'herencia', 'dependencia'] as const;
  return edges.map(e => {
    const tipo = e.data?.edgeType;
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      tipo: TIPOS.includes(tipo as never) ? (tipo as EdgeType['tipo']) : 'asociacion',
      multiplicidadOrigen: multiplicidadValida(e.data?.sourceMultiplicity),
      multiplicidadDestino: multiplicidadValida(e.data?.targetMultiplicity),
    };
  });
}

/** Camino inverso: del modelo UML al estado del editor. */
export function umlToFlowNodes(nodes: NodeType[]): Node[] {
  return nodes.map(n => ({
    id: n.id,
    type: 'default',
    position: { x: n.x, y: n.y },
    data: {
      label: n.label,
      attributes: (n.attributes ?? []).map((a, i) => ({
        id: `${n.id}_a${i}`,
        name: a.name,
        type: a.datatype,
        scope: a.scope,
      })),
      asociativa: n.asociativa,
      relaciona: n.relaciona,
    },
  }));
}

export function umlToFlowEdges(edges: EdgeType[]): Edge[] {
  return edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'umlEdge',
    data: {
      edgeType: e.tipo,
      sourceMultiplicity: e.multiplicidadOrigen,
      targetMultiplicity: e.multiplicidadDestino,
    },
  }));
}
