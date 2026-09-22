/**
 * Invitaciones por pizarra.
 *
 * El codigo de registro global (REGISTRO_CODIGO) resolvia el problema inmediato
 * -que no se registre cualquiera en un despliegue publico- de la peor manera:
 * un unico secreto para todo el sistema, sin vencimiento, que hay que repartir a
 * mano y que para cambiarlo hay que tocar la configuracion del servidor. Ademas
 * no dice nada: quien lo usa entra al sistema, pero no a ninguna pizarra en
 * particular.
 *
 * Una invitacion es lo contrario en cada punto: nace de una pizarra, la crea su
 * anfitrion, vence sola, se puede revocar, y quien la usa queda directamente
 * como miembro de esa pizarra con el rol que el anfitrion eligio. Es, ademas, lo
 * que el CU02 del documento describe.
 */
import { randomBytes } from 'node:crypto';
import { pool } from '../db.js';
import type { Rol } from './acceso.js';

/** Duracion por defecto. Una semana alcanza para un trabajo de grupo. */
const DIAS_VALIDA = 7;

export interface Invitacion {
  token: string;
  boardId: string;
  rol: Rol;
  expiraEn: string;
  usosMax: number;
  usos: number;
}

interface FilaInvitacion {
  token: string;
  board_id: string;
  rol: string;
  expira_en: Date;
  usos_max: number;
  usos: number;
  revocada: boolean;
}

const ROLES_INVITABLES: Rol[] = ['editor', 'lector'];

const aInvitacion = (f: FilaInvitacion): Invitacion => ({
  token: f.token,
  boardId: f.board_id,
  rol: (ROLES_INVITABLES.includes(f.rol as Rol) ? f.rol : 'editor') as Rol,
  expiraEn: f.expira_en.toISOString(),
  usosMax: f.usos_max,
  usos: f.usos,
});

/**
 * Crea una invitacion. El token es aleatorio de 32 bytes en base64url: es el
 * secreto entero, asi que no puede ser adivinable ni corto.
 */
export async function crearInvitacion(
  boardId: string,
  creadaPor: string | null,
  opciones: { rol?: Rol; dias?: number; usosMax?: number } = {}
): Promise<Invitacion> {
  const rol: Rol = ROLES_INVITABLES.includes(opciones.rol as Rol)
    ? (opciones.rol as Rol)
    : 'editor';
  const dias = Number.isFinite(opciones.dias) ? Math.min(Math.max(Number(opciones.dias), 1), 90) : DIAS_VALIDA;
  const usosMax = Number.isFinite(opciones.usosMax) ? Math.max(Number(opciones.usosMax), 0) : 0;
  const token = randomBytes(32).toString('base64url');

  const { rows } = await pool.query<FilaInvitacion>(
    `INSERT INTO board_invites (token, board_id, rol, creada_por, expira_en, usos_max)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval, $6)
     RETURNING token, board_id, rol, expira_en, usos_max, usos, revocada`,
    [token, boardId, rol, creadaPor, String(dias), usosMax]
  );
  return aInvitacion(rows[0]);
}

/**
 * Busca una invitacion utilizable. Devuelve null si no existe, vencio, fue
 * revocada o se quedo sin usos: desde afuera los cuatro casos son el mismo, y
 * distinguirlos solo le sirve a quien esta probando tokens al azar.
 */
export async function leerInvitacion(
  token: string
): Promise<(Invitacion & { pizarra: string }) | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const { rows } = await pool.query<FilaInvitacion & { pizarra: string }>(
    `SELECT i.token, i.board_id, i.rol, i.expira_en, i.usos_max, i.usos, i.revocada,
            b.name AS pizarra
       FROM board_invites i
       JOIN boards b ON b.id = i.board_id
      WHERE i.token = $1`,
    [token]
  );
  if (rows.length === 0) return null;
  const f = rows[0];
  if (f.revocada) return null;
  if (f.expira_en.getTime() < Date.now()) return null;
  if (f.usos_max > 0 && f.usos >= f.usos_max) return null;
  return { ...aInvitacion(f), pizarra: f.pizarra };
}

/**
 * Da de alta al usuario en la pizarra y suma un uso.
 *
 * El UPDATE con la condicion de usos adentro es lo que hace que dos personas
 * usando el mismo enlace de un solo uso al mismo tiempo no entren las dos: gana
 * la primera, la segunda no encuentra fila para actualizar.
 */
export async function usarInvitacion(token: string, usuarioId: string): Promise<Invitacion | null> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query<FilaInvitacion>(
      `UPDATE board_invites
          SET usos = usos + 1
        WHERE token = $1
          AND revocada = false
          AND expira_en > now()
          AND (usos_max = 0 OR usos < usos_max)
        RETURNING token, board_id, rol, expira_en, usos_max, usos, revocada`,
      [token]
    );
    if (rows.length === 0) {
      await cliente.query('ROLLBACK');
      return null;
    }
    const inv = aInvitacion(rows[0]);
    await cliente.query(
      `INSERT INTO board_members (board_id, usuario_id, rol)
       VALUES ($1, $2, $3)
       ON CONFLICT (board_id, usuario_id) DO NOTHING`,
      [inv.boardId, usuarioId, inv.rol]
    );
    await cliente.query('COMMIT');
    return inv;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}

/** Invitaciones vigentes de una pizarra, para que el anfitrion las administre. */
export async function invitacionesDe(boardId: string): Promise<Invitacion[]> {
  const { rows } = await pool.query<FilaInvitacion>(
    `SELECT token, board_id, rol, expira_en, usos_max, usos, revocada
       FROM board_invites
      WHERE board_id = $1 AND revocada = false AND expira_en > now()
      ORDER BY created_at DESC`,
    [boardId]
  );
  return rows.map(aInvitacion);
}

export async function revocarInvitacion(boardId: string, token: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'UPDATE board_invites SET revocada = true WHERE board_id = $1 AND token = $2',
    [boardId, token]
  );
  return (rowCount ?? 0) > 0;
}
