import { pool } from './db.js';
import { applyOp, emptyDoc, normalizeDoc } from './collab.js';
import type { CommittedOp, DiagramDoc, Op } from './types.js';

/**
 * Estado en memoria de un diagrama abierto.
 * `chain` serializa las escrituras: todas las ops de un diagrama se aplican en una
 * sola fila, asi dos clientes concurrentes nunca pelean por el mismo numero de `seq`.
 */
interface RoomState {
  doc: DiagramDoc;
  seq: number;
  chain: Promise<unknown>;
}

const rooms = new Map<string, RoomState>();

async function loadRoom(diagramId: string): Promise<RoomState> {
  const existing = rooms.get(diagramId);
  if (existing) return existing;

  const { rows } = await pool.query<{ doc: unknown; seq: string }>(
    'SELECT doc, seq::text AS seq FROM diagrams WHERE id = $1',
    [diagramId]
  );
  if (rows.length === 0) throw new Error(`Diagrama no encontrado: ${diagramId}`);

  const state: RoomState = {
    doc: normalizeDoc(rows[0].doc),
    seq: Number(rows[0].seq ?? 0),
    chain: Promise.resolve(),
  };
  rooms.set(diagramId, state);
  return state;
}

/** Encola un trabajo sobre el diagrama, garantizando ejecucion de uno en uno. */
function serialize<T>(state: RoomState, job: () => Promise<T>): Promise<T> {
  const next = state.chain.then(job, job);
  // La cadena nunca debe quedar rechazada, o bloquearia todas las ops siguientes.
  state.chain = next.catch(() => undefined);
  return next;
}

export async function getSnapshot(diagramId: string): Promise<{ doc: DiagramDoc; seq: number }> {
  const state = await loadRoom(diagramId);
  return { doc: state.doc, seq: state.seq };
}

/** Ops confirmadas posteriores a `sinceSeq`. Sirve para que un cliente que estuvo
 *  desconectado se pongan al dia sin recargar el documento completo. */
export async function getOpsSince(diagramId: string, sinceSeq: number): Promise<CommittedOp[]> {
  const { rows } = await pool.query(
    `SELECT op_id, seq::text AS seq, client_id, actor_name, kind, payload
       FROM diagram_ops
      WHERE diagram_id = $1 AND seq > $2
      ORDER BY seq ASC
      LIMIT 2000`,
    [diagramId, sinceSeq]
  );
  return rows.map(r => ({
    opId: r.op_id,
    seq: Number(r.seq),
    clientId: r.client_id,
    actorName: r.actor_name ?? undefined,
    kind: r.kind,
    payload: r.payload,
  }));
}

/**
 * Aplica un lote de ops de un cliente.
 *
 * - Descarta por `op_id` las que ya estaban registradas (reenvio tras reconectar).
 * - Asigna un `seq` creciente a cada op aceptada: ese es el orden total que todos comparten.
 * - Persiste documento y bitacora en una sola transaccion.
 */
export async function commitOps(diagramId: string, ops: Op[]): Promise<CommittedOp[]> {
  if (ops.length === 0) return [];
  const state = await loadRoom(diagramId);

  return serialize(state, async () => {
    const incomingIds = ops.map(o => o.opId);
    const { rows: known } = await pool.query<{ op_id: string }>(
      'SELECT op_id FROM diagram_ops WHERE op_id = ANY($1::uuid[])',
      [incomingIds]
    );
    const alreadyApplied = new Set(known.map(r => r.op_id));

    const committed: CommittedOp[] = [];
    let seq = state.seq;

    for (const op of ops) {
      if (alreadyApplied.has(op.opId)) continue;
      if (!applyOp(state.doc, op)) continue;
      seq += 1;
      committed.push({ ...op, seq });
    }

    if (committed.length === 0) return [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const op of committed) {
        await client.query(
          `INSERT INTO diagram_ops (op_id, diagram_id, seq, client_id, actor_name, kind, payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (op_id) DO NOTHING`,
          [
            op.opId,
            diagramId,
            op.seq,
            op.clientId,
            op.actorName ?? null,
            op.kind,
            JSON.stringify(op.payload),
          ]
        );
      }
      await client.query(
        `UPDATE diagrams SET doc = $1, seq = $2, updated_at = now() WHERE id = $3`,
        [JSON.stringify(state.doc), seq, diagramId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      // El estado en memoria quedo adelantado respecto a la BD: lo invalidamos para
      // que la proxima lectura lo recargue desde Postgres.
      rooms.delete(diagramId);
      throw err;
    } finally {
      client.release();
    }

    state.seq = seq;
    return committed;
  });
}

/** De un conjunto de opIds, cuales ya estaban en la bitacora (es decir, son reenvios). */
export async function knownOpIds(diagramId: string, opIds: string[]): Promise<Set<string>> {
  if (opIds.length === 0) return new Set();
  const { rows } = await pool.query<{ op_id: string }>(
    'SELECT op_id FROM diagram_ops WHERE diagram_id = $1 AND op_id = ANY($2::uuid[])',
    [diagramId, opIds]
  );
  return new Set(rows.map(r => r.op_id));
}

export function forgetRoom(diagramId: string): void {
  rooms.delete(diagramId);
}

export { emptyDoc };
