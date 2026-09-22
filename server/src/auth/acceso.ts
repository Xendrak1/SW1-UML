import { pool } from '../db.js';
import { config } from '../config.js';

/**
 * Quien puede hacer que sobre una pizarra.
 *
 * Reglas, deliberadamente pocas:
 *   - el dueno (quien la creo) administra: renombrar, eliminar, y es el anfitrion;
 *   - cualquier usuario autenticado que abra el enlace queda como miembro editor;
 *   - un lector solo mira.
 *
 * El enlace de invitacion sigue siendo la forma de sumar gente, como antes, pero
 * ahora del otro lado hay una cuenta: el enlace por si solo ya no alcanza, hay
 * que haber iniciado sesion.
 */

export type Rol = 'propietario' | 'editor' | 'lector' | 'pendiente';

export interface Acceso {
  rol: Rol;
  esPropietario: boolean;
  diagramId: string;
}

/**
 * Resuelve el acceso de un usuario a una pizarra, dandolo de alta como editor
 * la primera vez que entra. Devuelve null si la pizarra no existe.
 */
export async function accesoAPizarra(boardId: string, usuarioId: string | null): Promise<Acceso | null> {
  const { rows } = await pool.query<{ diagram_id: string; owner_id: string | null }>(
    'SELECT diagram_id, owner_id FROM boards WHERE id = $1',
    [boardId]
  );
  if (rows.length === 0) return null;
  const { diagram_id, owner_id } = rows[0];

  // Sin autenticacion exigida (perilla de emergencia) todos entran como editores.
  if (!usuarioId) {
    if (config.auth.requerida) return null;
    return { rol: 'editor', esPropietario: false, diagramId: diagram_id };
  }

  if (owner_id === usuarioId) {
    return { rol: 'propietario', esPropietario: true, diagramId: diagram_id };
  }

  // Las pizarras creadas antes de existir la autenticacion no tienen dueno: la
  // adopta el primer usuario autenticado que la abra, para no dejarlas
  // huerfanas y sin quien las administre.
  if (owner_id === null) {
    const adoptada = await pool.query(
      'UPDATE boards SET owner_id = $1 WHERE id = $2 AND owner_id IS NULL RETURNING id',
      [usuarioId, boardId]
    );
    if ((adoptada.rowCount ?? 0) > 0) {
      await registrarMiembro(boardId, usuarioId, 'propietario');
      return { rol: 'propietario', esPropietario: true, diagramId: diagram_id };
    }
  }

  const miembro = await pool.query<{ rol: Rol }>(
    'SELECT rol FROM board_members WHERE board_id = $1 AND usuario_id = $2',
    [boardId, usuarioId]
  );
  if (miembro.rows.length > 0) {
    const rol = miembro.rows[0].rol;
    return { rol, esPropietario: rol === 'propietario', diagramId: diagram_id };
  }

  // Primera vez que entra con el enlace: queda como editor.
  await registrarMiembro(boardId, usuarioId, 'editor');
  return { rol: 'editor', esPropietario: false, diagramId: diagram_id };
}

export async function registrarMiembro(boardId: string, usuarioId: string, rol: Rol): Promise<void> {
  await pool.query(
    `INSERT INTO board_members (board_id, usuario_id, rol) VALUES ($1, $2, $3)
     ON CONFLICT (board_id, usuario_id) DO UPDATE SET rol = EXCLUDED.rol`,
    [boardId, usuarioId, rol]
  );
}

/** Acceso a partir del diagrama, que es lo que identifica a la sala del WebSocket. */
export async function accesoADiagrama(
  diagramId: string,
  usuarioId: string | null
): Promise<Acceso | null> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM boards WHERE diagram_id = $1 ORDER BY created_at ASC LIMIT 1',
    [diagramId]
  );
  // Un diagrama sin pizarra no deberia existir, pero si pasa no se bloquea el
  // trabajo: se trata como una sala abierta para los usuarios autenticados.
  if (rows.length === 0) {
    if (!usuarioId && config.auth.requerida) return null;
    return { rol: 'editor', esPropietario: false, diagramId };
  }
  return accesoAPizarra(rows[0].id, usuarioId);
}
