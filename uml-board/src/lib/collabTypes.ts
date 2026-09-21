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

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export type ServerMessage =
  | { type: 'snapshot'; diagramId: string; doc: DiagramDoc; seq: number }
  | { type: 'ops'; ops: CommittedOp[] }
  | { type: 'ack'; accepted: string[]; rejected: string[]; seq: number }
  | { type: 'presence'; participants: Participant[] }
  | { type: 'error'; message: string }
  | { type: 'pong' };
