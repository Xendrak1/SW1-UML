import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';
import { create } from 'zustand';
import { collabClient } from '../lib/collabClient';
import type {
  CommittedOp,
  ConnectionStatus,
  DiagramDoc,
  DiagramEdge,
  DiagramNode,
  Op,
  OpKind,
  Participant,
} from '../lib/collabTypes';

type AttrType = 'Integer' | 'Float' | 'String' | 'Boolean' | 'Date';
type Scope = 'public' | 'private' | 'protected';
type Multiplicity = '1' | '*' | '1..*';

interface ClassData {
  label: string;
  attributes: { id: string; name: string; type: AttrType; scope: Scope }[];
  asociativa?: boolean;
  relaciona?: string[];
}

interface EdgeData {
  sourceMultiplicity: Multiplicity;
  targetMultiplicity: Multiplicity;
  edgeType?: string;
}

export interface Conflicto {
  id: string;
  /** Nombre de quien piso el cambio. */
  autor: string;
  clase: string;
  /** Atributo concreto, cuando el cambio fue sobre la lista de atributos. */
  campo: string;
  cuando: number;
}

interface Store {
  nodes: Node<ClassData>[];
  edges: Edge<EdgeData>[];
  currentDiagramId: string | null;
  isLoading: boolean;
  error: string | null;

  // Estado colaborativo, para mostrarlo en la barra de herramientas
  connection: ConnectionStatus;
  pendingOps: number;
  participants: Participant[];
  /**
   * Avisos de edicion simultanea sobre el mismo campo.
   *
   * El orden total ya garantiza que el documento no se corrompa, pero si dos
   * personas tocan el MISMO atributo gana el ultimo y el otro no se entera: su
   * texto desaparece sin explicacion. El enunciado pide resolver justamente ese
   * caso, y la parte que faltaba es la humana: decirselo.
   */
  conflictos: Conflicto[];
  descartarConflicto: (id: string) => void;

  // Edicion del diagrama
  addClass: () => void;
  updateNode: (id: string, data: Partial<ClassData>) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (params: Connection) => void;
  updateEdge: (edgeId: string, d: Partial<EdgeData>) => void;
  /** Reemplazo masivo: importar un archivo o aplicar un lote del asistente de IA. */
  replaceDocument: (nodes: Node<ClassData>[], edges: Edge<EdgeData>[]) => void;
  setSelection: (nodeId: string | null) => void;

  // Ciclo de vida de la sesion colaborativa
  setCurrentDiagram: (diagramId: string) => void;
  loadDiagram: (diagramId: string) => Promise<void>;
  /** Fuerza el envio de lo pendiente. Se mantiene por compatibilidad con la UI. */
  saveDiagram: () => Promise<void>;
  cleanupRealtimeSync: () => void;
}

// ---------------- conversiones entre el documento y ReactFlow ----------------

const toFlowNode = (n: DiagramNode): Node<ClassData> => ({
  id: n.id,
  type: n.type || 'default',
  position: n.position ?? { x: 0, y: 0 },
  data: {
    label: n.data?.label ?? 'Class',
    attributes: (n.data?.attributes ?? []).map(a => ({
      id: a.id ?? uuidv4(),
      name: a.name,
      type: a.type as AttrType,
      scope: a.scope as Scope,
    })),
    asociativa: n.data?.asociativa,
    relaciona: n.data?.relaciona,
  },
});

const toDocNode = (n: Node<ClassData>): DiagramNode => ({
  id: n.id,
  type: n.type || 'default',
  position: n.position,
  data: {
    label: n.data.label,
    attributes: n.data.attributes ?? [],
    asociativa: n.data.asociativa,
    relaciona: n.data.relaciona,
  },
});

const toFlowEdge = (e: DiagramEdge): Edge<EdgeData> => ({
  id: e.id,
  source: e.source,
  target: e.target,
  type: e.type || 'umlEdge',
  data: {
    sourceMultiplicity: (e.data?.sourceMultiplicity ?? '1') as Multiplicity,
    targetMultiplicity: (e.data?.targetMultiplicity ?? '1') as Multiplicity,
    edgeType: e.data?.edgeType ?? 'asociacion',
  },
});

const toDocEdge = (e: Edge<EdgeData>): DiagramEdge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  type: e.type ?? 'umlEdge',
  data: {
    edgeType: e.data?.edgeType,
    sourceMultiplicity: e.data?.sourceMultiplicity,
    targetMultiplicity: e.data?.targetMultiplicity,
  },
});

export const useClassStore = create<Store>((set, get) => {
  /**
   * Lo que YO toque hace poco: clave "nodo|campo" -> momento.
   *
   * Sirve para detectar que otra persona piso un cambio mio. La ventana es
   * corta a proposito: pasados unos segundos ya no es una edicion simultanea,
   * es simplemente el trabajo de otro sobre algo que yo edite antes, y avisar
   * de eso seria ruido.
   */
  const misEdiciones = new Map<string, number>();
  const VENTANA_MS = 20_000;

  const marcarEdicion = (nodeId: string, campos: string[]) => {
    const ahora = Date.now();
    for (const c of campos) misEdiciones.set(`${nodeId}|${c}`, ahora);
    // Limpieza oportunista, para que el mapa no crezca sin limite.
    for (const [k, t] of misEdiciones) if (ahora - t > VENTANA_MS) misEdiciones.delete(k);
  };

  /** Devuelve los campos que el cambio remoto pisa de lo que yo acababa de editar. */
  const camposPisados = (nodeId: string, campos: string[]): string[] => {
    const ahora = Date.now();
    return campos.filter(c => {
      const t = misEdiciones.get(`${nodeId}|${c}`);
      return t !== undefined && ahora - t <= VENTANA_MS;
    });
  };

  const avisarConflicto = (autor: string, clase: string, campo: string) => {
    set(s => {
      // Un solo aviso por clase y campo: si la otra persona sigue escribiendo,
      // no tiene sentido apilar diez avisos de lo mismo.
      if (s.conflictos.some(c => c.clase === clase && c.campo === campo)) return s;
      return {
        conflictos: [
          ...s.conflictos,
          { id: uuidv4(), autor, clase, campo, cuando: Date.now() },
        ].slice(-4),
      };
    });
  };

  /** Aplica el cambio en local (optimista) y manda la operacion al servidor. */
  const emit = (kind: OpKind, payload: Record<string, unknown>) => {
    void collabClient.send([collabClient.buildOp(kind, payload, uuidv4())]);
  };

  const emitMany = (ops: Array<{ kind: OpKind; payload: Record<string, unknown> }>) => {
    if (ops.length === 0) return;
    const built: Op[] = ops.map(o => collabClient.buildOp(o.kind, o.payload, uuidv4()));
    void collabClient.send(built);
  };

  /** Aplica una operacion que llego de otro participante al estado de ReactFlow. */
  const applyRemote = (op: CommittedOp) => {
    // El payload varia segun el tipo de operacion; se valida al desestructurarlo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = op.payload as Record<string, any>;

    switch (op.kind) {
      case 'node.add': {
        const incoming = toFlowNode(p.node as DiagramNode);
        set(s => {
          const i = s.nodes.findIndex(n => n.id === incoming.id);
          if (i < 0) return { nodes: [...s.nodes, incoming] };
          const nodes = [...s.nodes];
          nodes[i] = { ...nodes[i], ...incoming };
          return { nodes };
        });
        break;
      }
      case 'node.move':
        set(s => ({
          nodes: s.nodes.map(n => (n.id === p.id ? { ...n, position: p.position } : n)),
        }));
        break;
      case 'node.update': {
        const nodoAntes = get().nodes.find(n => n.id === p.id);
        const parche = (p.patch?.data ?? {}) as Record<string, unknown>;

        // Que campos toca el cambio remoto. Para los atributos se compara uno
        // por uno: cambiar "precio" no deberia avisar a quien estaba editando
        // "nombre" de la misma clase.
        const campos: string[] = [];
        for (const clave of Object.keys(parche)) {
          if (clave !== 'attributes') {
            campos.push(clave);
            continue;
          }
          const antes = (nodoAntes?.data?.attributes ?? []) as Array<{ name?: string }>;
          const ahora = (parche.attributes ?? []) as Array<{ name?: string }>;
          const porNombre = new Map(antes.map(a => [a.name, JSON.stringify(a)]));
          for (const a of ahora) {
            if (porNombre.get(a.name) !== JSON.stringify(a)) campos.push(`atributo ${a.name}`);
          }
          // Un atributo que desaparecio tambien es un cambio sobre ese campo.
          const nombresAhora = new Set(ahora.map(a => a.name));
          for (const a of antes) if (!nombresAhora.has(a.name)) campos.push(`atributo ${a.name}`);
        }

        const pisados = camposPisados(String(p.id), campos);

        set(s => ({
          nodes: s.nodes.map(n =>
            n.id === p.id
              ? { ...n, ...p.patch, data: { ...n.data, ...(p.patch?.data ?? {}) } }
              : n
          ),
        }));

        if (pisados.length > 0) {
          const autor = op.actorName ?? 'Otro participante';
          const clase = String(nodoAntes?.data?.label ?? 'una clase');
          for (const campo of pisados) avisarConflicto(autor, clase, campo);
        }
        break;
      }
      case 'node.remove':
        set(s => ({
          nodes: s.nodes.filter(n => n.id !== p.id),
          edges: s.edges.filter(e => e.source !== p.id && e.target !== p.id),
        }));
        break;
      case 'edge.add': {
        const incoming = toFlowEdge(p.edge as DiagramEdge);
        set(s =>
          s.edges.some(e => e.id === incoming.id) ? s : { edges: [...s.edges, incoming] }
        );
        break;
      }
      case 'edge.update':
        set(s => ({
          edges: s.edges.map(e =>
            e.id === p.id ? { ...e, ...p.patch, data: { ...e.data, ...(p.patch?.data ?? {}) } } : e
          ),
        }));
        break;
      case 'edge.remove':
        set(s => ({ edges: s.edges.filter(e => e.id !== p.id) }));
        break;
      case 'doc.replace':
        set({
          nodes: ((p.nodes ?? []) as DiagramNode[]).map(toFlowNode),
          edges: ((p.edges ?? []) as DiagramEdge[]).map(toFlowEdge),
        });
        break;
    }
  };

  const applySnapshot = (doc: DiagramDoc) => {
    set({
      nodes: (doc.nodes ?? []).map(toFlowNode),
      edges: (doc.edges ?? []).map(toFlowEdge),
      isLoading: false,
      error: null,
    });
  };

  return {
    nodes: [],
    edges: [],
    currentDiagramId: null,
    isLoading: false,
    error: null,
    connection: 'offline',
    pendingOps: 0,
    participants: [],
    conflictos: [],
    descartarConflicto: id => set(s => ({ conflictos: s.conflictos.filter(c => c.id !== id) })),

    // ---------------- edicion ----------------

    addClass: () => {
      const state = get();
      const node: Node<ClassData> = {
        id: uuidv4(),
        type: 'default',
        data: { label: `Class${state.nodes.length + 1}`, attributes: [] },
        position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      };
      set(s => ({ nodes: [...s.nodes, node] }));
      emit('node.add', { node: toDocNode(node) });
    },

    updateNode: (id, data) => {
      // Se anota ANTES de aplicar, para poder comparar con lo que llegue despues.
      const campos = Object.keys(data).flatMap(k =>
        k === 'attributes'
          ? ((data.attributes ?? []) as Array<{ name?: string }>).map(a => `atributo ${a.name}`)
          : [k]
      );
      marcarEdicion(id, campos);

      set(s => ({
        nodes: s.nodes.map(n => (n.id === id ? { ...n, data: { ...n.data, ...data } } : n)),
      }));
      // Se envia solo el trozo que cambio: si otra persona edita otro campo de la
      // misma clase, los dos cambios conviven.
      emit('node.update', { id, patch: { data } });
    },

    onNodesChange: changes => {
      set(s => ({ nodes: applyNodeChanges(changes, s.nodes) }));

      const ops: Array<{ kind: OpKind; payload: Record<string, unknown> }> = [];
      const nodes = get().nodes;

      for (const change of changes) {
        if (change.type === 'add') {
          ops.push({ kind: 'node.add', payload: { node: toDocNode(change.item as Node<ClassData>) } });
        } else if (change.type === 'remove') {
          ops.push({ kind: 'node.remove', payload: { id: change.id } });
        } else if (change.type === 'position') {
          // Solo al soltar: si mandaramos cada pixel del arrastre, inundariamos
          // la red y la bitacora de auditoria.
          if (change.dragging === false) {
            const node = nodes.find(n => n.id === change.id);
            if (node) ops.push({ kind: 'node.move', payload: { id: node.id, position: node.position } });
          }
        } else if (change.type === 'reset') {
          ops.push({ kind: 'node.add', payload: { node: toDocNode(change.item as Node<ClassData>) } });
        }
        // 'select' y 'dimensions' son estado local de la vista: no se comparten.
      }
      emitMany(ops);
    },

    onEdgesChange: changes => {
      set(s => ({
        edges: applyEdgeChanges(changes, s.edges).map(e => ({
          ...e,
          data: {
            sourceMultiplicity: ((e.data as EdgeData)?.sourceMultiplicity ?? '1') as Multiplicity,
            targetMultiplicity: ((e.data as EdgeData)?.targetMultiplicity ?? '1') as Multiplicity,
            edgeType: (e.data as EdgeData)?.edgeType,
          },
        })) as Edge<EdgeData>[],
      }));

      const ops: Array<{ kind: OpKind; payload: Record<string, unknown> }> = [];
      for (const change of changes) {
        if (change.type === 'add') {
          ops.push({ kind: 'edge.add', payload: { edge: toDocEdge(change.item as Edge<EdgeData>) } });
        } else if (change.type === 'remove') {
          ops.push({ kind: 'edge.remove', payload: { id: change.id } });
        }
      }
      emitMany(ops);
    },

    onConnect: params => {
      const edge: Edge<EdgeData> = {
        ...params,
        id: `${params.source}-${params.target}-${Date.now()}`,
        type: 'umlEdge',
        data: { sourceMultiplicity: '1', targetMultiplicity: '1', edgeType: 'asociacion' },
        source: params.source ?? '',
        target: params.target ?? '',
        sourceHandle: params.sourceHandle,
        targetHandle: params.targetHandle,
      };
      set(s => ({ edges: addEdge(edge, s.edges) }));
      emit('edge.add', { edge: toDocEdge(edge) });
    },

    updateEdge: (edgeId, d) => {
      set(s => ({
        edges: s.edges.map(e =>
          e.id === edgeId
            ? {
                ...e,
                data: {
                  sourceMultiplicity: (d.sourceMultiplicity ??
                    e.data?.sourceMultiplicity ??
                    '1') as Multiplicity,
                  targetMultiplicity: (d.targetMultiplicity ??
                    e.data?.targetMultiplicity ??
                    '1') as Multiplicity,
                  edgeType: d.edgeType ?? e.data?.edgeType,
                },
              }
            : e
        ),
      }));
      emit('edge.update', { id: edgeId, patch: { data: d } });
    },

    replaceDocument: (nodes, edges) => {
      set({ nodes, edges });
      emit('doc.replace', { nodes: nodes.map(toDocNode), edges: edges.map(toDocEdge) });
    },

    setSelection: nodeId => collabClient.announceSelection(nodeId),

    // ---------------- sesion colaborativa ----------------

    setCurrentDiagram: diagramId => {
      if (get().currentDiagramId !== diagramId) {
        collabClient.disconnect();
        set({ currentDiagramId: diagramId });
      }
    },

    loadDiagram: async diagramId => {
      set({ isLoading: true, error: null, currentDiagramId: diagramId });

      await collabClient.connect(diagramId, {
        onSnapshot: doc => applySnapshot(doc),
        onRemoteOps: ops => ops.forEach(applyRemote),
        onPresence: participants => set({ participants }),
        onStatus: (connection, pending) => set({ connection, pendingOps: pending }),
      });

      // Si no hubo cache ni llego snapshot todavia, dejamos de mostrar el cargando
      // a los 3 segundos: sin red la app tiene que quedar usable igual.
      setTimeout(() => {
        if (get().isLoading) set({ isLoading: false });
      }, 3000);
    },

    saveDiagram: async () => {
      // Ya no existe "guardar": cada cambio viaja como operacion y queda persistido.
      // Esta funcion solo empuja la cache y lo pendiente.
      const { nodes, edges } = get();
      collabClient.cacheCurrent({
        nodes: nodes.map(toDocNode),
        edges: edges.map(toDocEdge),
        deleted: [],
      });
    },

    cleanupRealtimeSync: () => {
      collabClient.disconnect();
      set({ connection: 'offline', participants: [] });
    },
  };
});
