// Tipos compartidos del protocolo colaborativo.
// Este archivo tiene un espejo en uml-board/src/lib/collabTypes.ts: mantener ambos en sinc.

export interface DiagramNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: {
    label?: string;
    attributes?: Array<{ id: string; name: string; type: string; scope: string }>;
    asociativa?: boolean;
    relaciona?: string[];
  };
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  data?: {
    edgeType?: string;
    sourceMultiplicity?: string;
    targetMultiplicity?: string;
  };
}

/** Documento materializado. `deleted` son tombstones: evitan que una op tardia resucite algo borrado. */
export interface DiagramDoc {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  deleted: string[];
}

export type OpKind =
  | 'node.add'
  | 'node.update'
  | 'node.move'
  | 'node.remove'
  | 'edge.add'
  | 'edge.update'
  | 'edge.remove'
  | 'doc.replace';

/** Operacion granular. `opId` lo genera el cliente: es la clave de idempotencia al reconectar. */
export interface Op {
  opId: string;
  kind: OpKind;
  clientId: string;
  actorName?: string;
  /** Reloj local del emisor. Se usa solo para depurar/auditar; el orden real lo fija `seq` del servidor. */
  localTs?: number;
  payload: Record<string, unknown>;
}

/** Operacion ya aceptada por el servidor, con su lugar en el orden total. */
export interface CommittedOp extends Op {
  seq: number;
}

export interface Participant {
  clientId: string;
  name: string;
  color: string;
  /** Nodo que el participante esta editando o arrastrando, para bloqueo suave. */
  selection?: string | null;
  /**
   * Anfitrion de la sesion: el primero que entro al diagrama y sigue conectado.
   * El enunciado lo pide ("quien inicia la sesion, deberia haber algun
   * anfitrion"). Si se va, el rol pasa al mas antiguo de los que quedan, asi la
   * sesion nunca se queda sin anfitrion.
   */
  esAnfitrion?: boolean;
  /** Momento en que entro, para poder decidir el traspaso del rol. */
  desde?: number;
  /** Rol sobre la pizarra: propietario, editor o lector. */
  rol?: string;
  /** Id del usuario si esta autenticado, util para expulsarlo. */
  usuarioId?: string;
}

// ---- Mensajes cliente -> servidor ----
export type ClientMessage =
  | {
      type: 'join';
      diagramId: string;
      clientId: string;
      name: string;
      color: string;
      /**
       * Token de sesion. El nombre y el color de arriba son solo una
       * preferencia visual: cuando hay token, la identidad real sale de el.
       */
      token?: string;
      /** Ultimo seq que el cliente tiene aplicado. 0 si arranca de cero. */
      lastSeq: number;
    }
  | { type: 'ops'; ops: Op[] }
  | { type: 'selection'; selection: string | null }
  /** Pide el documento completo. El cliente lo usa cuando detecta que quedo divergente. */
  | { type: 'resync' }
  | { type: 'ping' };

// ---- Mensajes servidor -> cliente ----
export type ServerMessage
  = { type: 'snapshot'; diagramId: string; doc: DiagramDoc; seq: number }
  | { type: 'ops'; ops: CommittedOp[] }
  /**
   * Confirmacion al emisor. `rejected` lleva las ops que el servidor descarto
   * (por ejemplo una edicion sobre algo que otro ya borro): al recibirlas el cliente
   * sabe que su estado optimista quedo divergente y pide un resync.
   */
  | { type: 'ack'; accepted: string[]; rejected: string[]; seq: number }
  | { type: 'presence'; participants: Participant[] }
  | { type: 'error'; message: string }
  | { type: 'pong' };
