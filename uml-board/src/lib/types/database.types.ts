/**
 * Tipos de la base de datos de la aplicacion.
 * Antes eran los tipos generados por Supabase; ahora describen el esquema propio
 * definido en server/sql/schema.sql.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface ReactFlowNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data?: {
    label?: string;
    attributes?: Array<{ id: string; name: string; type: string; scope: string }>;
    asociativa?: boolean;
    relaciona?: string[];
  };
}

export interface ReactFlowEdge {
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

export interface Diagram {
  id: string;
  name: string;
  doc: { nodes: ReactFlowNode[]; edges: ReactFlowEdge[]; deleted: string[] };
  seq: number;
  created_at: string;
  updated_at: string;
}

export interface Board {
  id: string;
  name: string;
  diagram_id: string;
  created_at: string;
}
