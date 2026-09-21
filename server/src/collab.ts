import type { DiagramDoc, DiagramEdge, DiagramNode, Op } from './types.js';

export const emptyDoc = (): DiagramDoc => ({ nodes: [], edges: [], deleted: [] });

/** Normaliza un doc leido de la BD (documentos viejos pueden no tener `deleted`). */
export function normalizeDoc(raw: unknown): DiagramDoc {
  const doc = (raw ?? {}) as Partial<DiagramDoc>;
  return {
    nodes: Array.isArray(doc.nodes) ? doc.nodes : [],
    edges: Array.isArray(doc.edges) ? doc.edges : [],
    deleted: Array.isArray(doc.deleted) ? doc.deleted : [],
  };
}

const MAX_TOMBSTONES = 2000;

function tombstone(doc: DiagramDoc, id: string) {
  if (!doc.deleted.includes(id)) doc.deleted.push(id);
  // La lista de tombstones no puede crecer sin limite: conservamos los mas recientes.
  if (doc.deleted.length > MAX_TOMBSTONES) {
    doc.deleted = doc.deleted.slice(doc.deleted.length - MAX_TOMBSTONES);
  }
}

/**
 * Aplica una operacion al documento, mutandolo.
 *
 * Tres propiedades que hacen que la colaboracion no se pise:
 *  1. Idempotencia: aplicar dos veces la misma op da el mismo resultado, asi que al
 *     reconectar podemos reenviar la cola sin miedo y el emisor puede aplicar en optimista.
 *  2. Granularidad: se fusiona por campo (`patch`), no se reemplaza el documento entero,
 *     asi dos personas editando clases distintas nunca se sobreescriben.
 *  3. Tombstones: una op tardia sobre algo ya borrado se ignora en vez de resucitarlo.
 *
 * Devuelve false si la op fue descartada (no genera cambio ni seq nuevo).
 */
export function applyOp(doc: DiagramDoc, op: Op): boolean {
  const p = op.payload as Record<string, any>;

  switch (op.kind) {
    case 'node.add': {
      const node = p.node as DiagramNode | undefined;
      if (!node?.id) return false;
      if (doc.deleted.includes(node.id)) return false;
      const i = doc.nodes.findIndex(n => n.id === node.id);
      if (i >= 0) doc.nodes[i] = { ...doc.nodes[i], ...node };
      else doc.nodes.push(node);
      return true;
    }

    case 'node.move': {
      const { id, position } = p as { id?: string; position?: { x: number; y: number } };
      if (!id || !position) return false;
      const node = doc.nodes.find(n => n.id === id);
      if (!node) return false;
      node.position = { x: position.x, y: position.y };
      return true;
    }

    case 'node.update': {
      const { id, patch } = p as { id?: string; patch?: Partial<DiagramNode> & { data?: any } };
      if (!id || !patch) return false;
      const i = doc.nodes.findIndex(n => n.id === id);
      if (i < 0) return false;
      const prev = doc.nodes[i];
      doc.nodes[i] = {
        ...prev,
        ...patch,
        // `data` se fusiona campo por campo: renombrar una clase no borra sus atributos
        // aunque la otra persona los haya cambiado en paralelo.
        data: { ...prev.data, ...(patch.data ?? {}) },
      };
      return true;
    }

    case 'node.remove': {
      const { id } = p as { id?: string };
      if (!id) return false;
      const before = doc.nodes.length;
      doc.nodes = doc.nodes.filter(n => n.id !== id);
      // Al borrar una clase se van sus relaciones: el diagrama no queda con aristas colgadas.
      doc.edges = doc.edges.filter(e => e.source !== id && e.target !== id);
      tombstone(doc, id);
      return before !== doc.nodes.length || true;
    }

    case 'edge.add': {
      const edge = p.edge as DiagramEdge | undefined;
      if (!edge?.id) return false;
      if (doc.deleted.includes(edge.id)) return false;
      // No se acepta una relacion cuyos extremos ya no existen.
      const endsExist =
        doc.nodes.some(n => n.id === edge.source) && doc.nodes.some(n => n.id === edge.target);
      if (!endsExist) return false;
      const i = doc.edges.findIndex(e => e.id === edge.id);
      if (i >= 0) doc.edges[i] = { ...doc.edges[i], ...edge };
      else doc.edges.push(edge);
      return true;
    }

    case 'edge.update': {
      const { id, patch } = p as { id?: string; patch?: Partial<DiagramEdge> & { data?: any } };
      if (!id || !patch) return false;
      const i = doc.edges.findIndex(e => e.id === id);
      if (i < 0) return false;
      const prev = doc.edges[i];
      doc.edges[i] = { ...prev, ...patch, data: { ...prev.data, ...(patch.data ?? {}) } };
      return true;
    }

    case 'edge.remove': {
      const { id } = p as { id?: string };
      if (!id) return false;
      doc.edges = doc.edges.filter(e => e.id !== id);
      tombstone(doc, id);
      return true;
    }

    case 'doc.replace': {
      // Reemplazo masivo: importar un archivo, o un lote del asistente de IA.
      const { nodes, edges } = p as { nodes?: DiagramNode[]; edges?: DiagramEdge[] };
      if (!Array.isArray(nodes) || !Array.isArray(edges)) return false;
      doc.nodes = nodes;
      doc.edges = edges;
      // El reemplazo redefine el documento, asi que los tombstones anteriores dejan de aplicar.
      doc.deleted = [];
      return true;
    }

    default:
      return false;
  }
}

/** Aplica una lista de ops y devuelve solo las que produjeron cambio. */
export function applyOps(doc: DiagramDoc, ops: Op[]): Op[] {
  const accepted: Op[] = [];
  for (const op of ops) {
    if (applyOp(doc, op)) accepted.push(op);
  }
  return accepted;
}
