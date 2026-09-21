import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl });

const here = dirname(fileURLToPath(import.meta.url));

/** Aplica sql/schema.sql. Es idempotente (todo es CREATE ... IF NOT EXISTS). */
export async function runMigrations(): Promise<void> {
  const candidates = [
    resolve(here, '../sql/schema.sql'), // ejecutando src/ con tsx
    resolve(here, '../../sql/schema.sql'), // ejecutando dist/
  ];
  let sql: string | null = null;
  for (const path of candidates) {
    try {
      sql = await readFile(path, 'utf8');
      break;
    } catch {
      /* siguiente candidato */
    }
  }
  if (!sql) throw new Error('No se encontro sql/schema.sql');
  await pool.query(sql);
}

/** Crea una pizarra de arranque si la base esta vacia, para que la app no abra en blanco. */
export async function seedIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM boards');
  if (Number(rows[0]?.count ?? '0') > 0) return;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const diagram = await client.query<{ id: string }>(
      `INSERT INTO diagrams (name, doc) VALUES ($1, $2) RETURNING id`,
      ['Diagrama Principal', JSON.stringify({ nodes: [], edges: [], deleted: [] })]
    );
    await client.query(`INSERT INTO boards (id, name, diagram_id) VALUES ($1, $2, $3)`, [
      'board_principal',
      'Diagrama Principal',
      diagram.rows[0].id,
    ]);
    await client.query('COMMIT');
    console.log('[db] pizarra inicial creada');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
