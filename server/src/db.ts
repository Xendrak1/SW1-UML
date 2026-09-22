import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolConfig } from 'pg';
import { config } from './config.js';

/**
 * Configuracion TLS del pool. Ver config.databaseSsl para el porque.
 *
 * Tambien se activa si la propia cadena de conexion trae sslmode=require, que
 * es como lo escriben casi todos los proveedores en el panel: si no se mirara,
 * alguien pegaria la URL del proveedor y la conexion fallaria sin motivo claro.
 */
const loPideLaUrl = /[?&]sslmode=(require|verify-ca|verify-full)/.test(config.databaseUrl);

function tlsDeLaBase(): PoolConfig['ssl'] {
  if (!config.databaseSsl && !loPideLaUrl) return undefined;

  if (config.databaseCaFile !== '') {
    try {
      return { ca: readFileSync(resolve(process.cwd(), config.databaseCaFile), 'utf8') };
    } catch (err) {
      throw new Error(
        `No se pudo leer DATABASE_CA_FILE (${config.databaseCaFile}): ` +
          `${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.warn(
    '[db] TLS activo pero sin certificado de la autoridad: la conexion va cifrada y NO se ' +
      'verifica la identidad del servidor. Para cerrar eso, descarga el certificado de tu ' +
      'proveedor y apunta DATABASE_CA_FILE a el.'
  );
  return { rejectUnauthorized: false };
}

/**
 * pg vuelve a parsear `sslmode` de la cadena de conexion y esa lectura pisa el
 * `ssl` que le pasamos explicitamente (Object.assign en pg-connection-string
 * aplica el resultado del parseo DESPUES de nuestra config). Como el TLS ya lo
 * decidimos nosotros arriba, sacamos sslmode de la URL para que no interfiera.
 */
function connectionStringSinSslmode(): string {
  if (!loPideLaUrl) return config.databaseUrl;
  const url = new URL(config.databaseUrl);
  url.searchParams.delete('sslmode');
  return url.toString();
}

export const pool = new Pool({
  connectionString: connectionStringSinSslmode(),
  ssl: tlsDeLaBase(),
});

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
