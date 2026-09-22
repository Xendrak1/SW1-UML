// Espejo de server/src/types.ts. Mantener ambos archivos en sinc.

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

export interface Op {
  opId: string;
  kind: OpKind;
  clientId: string;
  actorName?: string;
  localTs?: number;
  payload: Record<string, unknown>;
}

export interface CommittedOp extends Op {
  seq: number;
}

export interface Participant {
  clientId: string;
  name: string;
  color: string;
  selection?: string | null;
  /** Anfitrion de la sesion: el propietario de la pizarra. */
  esAnfitrion?: boolean;
  desde?: number;
  /** Rol sobre la pizarra: propietario, editor o lector. */
  rol?: string;
}

/**
 * "rechazado" no es lo mismo que "offline" y por eso es un estado aparte: el
 * servidor esta ahi y contesta, lo que dijo es que NO con un motivo. Mostrar
 * "Sin conexion" en ese caso manda al usuario a revisar su internet cuando el
 * problema es su sesion o sus permisos, y encima reintenta para siempre.
 */
export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'rechazado';

export type ServerMessage =
  | { type: 'snapshot'; diagramId: string; doc: DiagramDoc; seq: number }
  | { type: 'ops'; ops: CommittedOp[] }
  | { type: 'ack'; accepted: string[]; rejected: string[]; seq: number }
  | { type: 'presence'; participants: Participant[] }
  | { type: 'error'; message: string }
  | { type: 'pong' };
