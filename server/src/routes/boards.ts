import { Router } from 'express';
import { pool } from '../db.js';
import { forgetRoom, getOpsSince, getSnapshot } from '../rooms.js';
import { plantillaInicial } from '../case/plantillaInicial.js';
import { accesoADiagrama, accesoAPizarra, registrarMiembro } from '../auth/acceso.js';
import {
  crearInvitacion,
  invitacionesDe,
  leerInvitacion,
  revocarInvitacion,
  usarInvitacion,
} from '../auth/invitaciones.js';

export const boardsRouter = Router();

/**
 * La sesion se exige en index.ts, para toda la superficie /api salvo /api/auth.
 *
 * No se pone aca con boardsRouter.use(): este router se monta en "/api", y un
 * use() sin ruta atrapa TODO lo que empiece con /api, incluidas las rutas de
 * IA y de intercambio que se montan despues. Ese detalle costo un 401 en los
 * endpoints equivocados.
 */

const idDe = (req: { sesion?: { sub: string } }): string | null => req.sesion?.sub ?? null;

/** Solo las pizarras del usuario: las que creo y aquellas a las que lo invitaron. */
boardsRouter.get('/boards', async (req, res, next) => {
  try {
    const usuarioId = idDe(req);
    if (!usuarioId) {
      // Perilla de emergencia: sin autenticacion se listan todas, como antes.
      const { rows } = await pool.query(
        'SELECT id, name, diagram_id, created_at, owner_id FROM boards ORDER BY created_at ASC'
      );
      res.json(rows);
      return;
    }
    const { rows } = await pool.query(
      `SELECT b.id, b.name, b.diagram_id, b.created_at, b.owner_id,
              (b.owner_id = $1) AS soy_propietario
         FROM boards b
         LEFT JOIN board_members m ON m.board_id = b.id AND m.usuario_id = $1
        WHERE b.owner_id = $1 OR m.usuario_id IS NOT NULL
        ORDER BY b.created_at ASC`,
      [usuarioId]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

boardsRouter.post('/boards', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const usuarioId = idDe(req);
    const name = String(req.body?.name ?? '').trim() || 'Pizarra';
    await client.query('BEGIN');
    const diagram = await client.query<{ id: string }>(
      `INSERT INTO diagrams (name, doc) VALUES ($1, $2) RETURNING id`,
      // Una pizarra nueva no arranca en blanco: ver plantillaInicial.
      [`Diagrama - ${name}`, JSON.stringify(plantillaInicial())]
    );
    const boardId = `board_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const board = await client.query(
      `INSERT INTO boards (id, name, diagram_id, owner_id) VALUES ($1, $2, $3, $4)
       RETURNING id, name, diagram_id, created_at, owner_id`,
      [boardId, name, diagram.rows[0].id, usuarioId]
    );
    await client.query('COMMIT');
    // Quien la crea es el anfitrion, y eso queda guardado: ya no depende de
    // quien se conecto primero.
    if (usuarioId) await registrarMiembro(boardId, usuarioId, 'propietario');
    res.status(201).json({ ...board.rows[0], soy_propietario: true });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/** Renombrar y eliminar son del propietario: es lo que distingue al anfitrion. */
async function exigirPropietario(
  boardId: string,
  usuarioId: string | null
): Promise<{ ok: true } | { ok: false; estado: number; error: string }> {
  const acceso = await accesoAPizarra(boardId, usuarioId);
  if (!acceso) return { ok: false, estado: 404, error: 'Pizarra no encontrada' };
  if (!acceso.esPropietario) {
    return {
      ok: false,
      estado: 403,
      error: 'Solo el anfitrion de la pizarra puede administrarla',
    };
  }
  return { ok: true };
}

boardsRouter.patch('/boards/:id', async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'Falta el campo "name"' });
      return;
    }
    const permiso = await exigirPropietario(req.params.id, idDe(req));
    if (!permiso.ok) {
      res.status(permiso.estado).json({ error: permiso.error });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE boards SET name = $1 WHERE id = $2
       RETURNING id, name, diagram_id, created_at, owner_id`,
      [name, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

boardsRouter.delete('/boards/:id', async (req, res, next) => {
  try {
    const permiso = await exigirPropietario(req.params.id, idDe(req));
    if (!permiso.ok) {
      res.status(permiso.estado).json({ error: permiso.error });
      return;
    }
    const { rows } = await pool.query<{ diagram_id: string }>(
      'SELECT diagram_id FROM boards WHERE id = $1',
      [req.params.id]
    );
    // El diagrama borra en cascada la pizarra y su bitacora de operaciones.
    await pool.query('DELETE FROM diagrams WHERE id = $1', [rows[0].diagram_id]);
    forgetRoom(rows[0].diagram_id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Documento completo. El cliente lo usa al abrir y como respaldo si el WebSocket no conecta. */
boardsRouter.get('/diagrams/:id', async (req, res, next) => {
  try {
    const acceso = await accesoADiagrama(req.params.id, idDe(req));
    if (!acceso) {
      res.status(404).json({ error: 'Diagrama no encontrado' });
      return;
    }
    const { doc, seq } = await getSnapshot(req.params.id);
    res.json({ id: req.params.id, doc, seq, rol: acceso.rol });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Diagrama no encontrado')) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
});

/** Bitacora de operaciones. Sirve para auditar quien cambio que y para la defensa oral. */
boardsRouter.get('/diagrams/:id/ops', async (req, res, next) => {
  try {
    const acceso = await accesoADiagrama(req.params.id, idDe(req));
    if (!acceso) {
      res.status(404).json({ error: 'Diagrama no encontrado' });
      return;
    }
    const since = Number(req.query.since ?? 0);
    res.json(await getOpsSince(req.params.id, Number.isFinite(since) ? since : 0));
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------- enlaces de invitacion

/**
 * El anfitrion crea un enlace para sumar gente a SU pizarra.
 *
 * Solo el propietario: si cualquier editor pudiera generar invitaciones, el
 * control sobre quien entra dejaria de estar donde el enunciado lo pone, que es
 * en el anfitrion de la sesion.
 */
boardsRouter.post('/boards/:id/invitaciones', async (req, res, next) => {
  try {
    const permiso = await exigirPropietario(req.params.id, idDe(req));
    if (!permiso.ok) {
      res.status(permiso.estado).json({ error: permiso.error });
      return;
    }
    const inv = await crearInvitacion(req.params.id, idDe(req), {
      rol: req.body?.rol,
      dias: req.body?.dias,
      usosMax: req.body?.usosMax,
    });
    res.status(201).json(inv);
  } catch (err) {
    next(err);
  }
});

/** Las invitaciones vigentes, para que el anfitrion vea y revoque. */
boardsRouter.get('/boards/:id/invitaciones', async (req, res, next) => {
  try {
    const permiso = await exigirPropietario(req.params.id, idDe(req));
    if (!permiso.ok) {
      res.status(permiso.estado).json({ error: permiso.error });
      return;
    }
    res.json(await invitacionesDe(req.params.id));
  } catch (err) {
    next(err);
  }
});

boardsRouter.delete('/boards/:id/invitaciones/:token', async (req, res, next) => {
  try {
    const permiso = await exigirPropietario(req.params.id, idDe(req));
    if (!permiso.ok) {
      res.status(permiso.estado).json({ error: permiso.error });
      return;
    }
    const quitada = await revocarInvitacion(req.params.id, String(req.params.token));
    if (!quitada) {
      res.status(404).json({ error: 'Esa invitacion no existe en esta pizarra' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * Quien ya tiene cuenta y abre un enlace de invitacion: se suma a la pizarra con
 * el rol que eligio el anfitrion.
 *
 * Hace falta ademas del registro porque no todo el mundo es nuevo: si un
 * compañero ya tiene cuenta, el enlace tiene que servirle igual, y sin esto
 * entraria por la puerta de "cualquier autenticado es editor", perdiendo el rol
 * de lector cuando el anfitrion invito como lector.
 */
boardsRouter.post('/invitaciones/:token/aceptar', async (req, res, next) => {
  try {
    const usuarioId = idDe(req);
    if (!usuarioId) {
      res.status(401).json({ error: 'Necesitas iniciar sesion' });
      return;
    }
    const token = String(req.params.token);
    const inv = await leerInvitacion(token);
    if (!inv) {
      res.status(404).json({ error: 'El enlace de invitacion no es valido o ya vencio' });
      return;
    }
    const usada = await usarInvitacion(token, usuarioId);
    if (!usada) {
      res.status(409).json({ error: 'El enlace de invitacion se agoto' });
      return;
    }
    // El rol efectivo es el del miembro, no el de la invitacion: quien ya era
    // miembro conserva el suyo, y quien entra por primera vez queda pendiente
    // de que el anfitrion lo apruebe.
    const miembro = await pool.query<{ rol: string }>(
      'SELECT rol FROM board_members WHERE board_id = $1 AND usuario_id = $2',
      [usada.boardId, usuarioId]
    );
    res.json({ boardId: usada.boardId, rol: miembro.rows[0]?.rol ?? 'pendiente', pizarra: inv.pizarra });
  } catch (err) {
    next(err);
  }
});

/**
 * Solicitudes de acceso: quien usa un enlace de invitacion queda como
 * "pendiente", y el anfitrion decide aca si lo deja entrar. Sin esto el enlace
 * solo era una llave: cualquiera que lo tuviera entraba sin que nadie mirara.
 */
boardsRouter.get('/boards/:id/pendientes', async (req, res, next) => {
  try {
    const usuarioId = idDe(req);
    if (!usuarioId) {
      res.status(401).json({ error: 'Necesitas iniciar sesion' });
      return;
    }
    const acceso = await accesoAPizarra(String(req.params.id), usuarioId);
    if (!acceso || !acceso.esPropietario) {
      res.status(403).json({ error: 'Solo el anfitrion ve las solicitudes de acceso' });
      return;
    }
    const { rows } = await pool.query<{
      usuario_id: string;
      nombre: string;
      correo: string;
      created_at: string;
    }>(
      `SELECT m.usuario_id, u.nombre, u.correo, m.created_at
         FROM board_members m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.board_id = $1 AND m.rol = 'pendiente'
        ORDER BY m.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

boardsRouter.post('/boards/:id/pendientes/:uid/aprobar', async (req, res, next) => {
  try {
    const usuarioId = idDe(req);
    if (!usuarioId) {
      res.status(401).json({ error: 'Necesitas iniciar sesion' });
      return;
    }
    const acceso = await accesoAPizarra(String(req.params.id), usuarioId);
    if (!acceso || !acceso.esPropietario) {
      res.status(403).json({ error: 'Solo el anfitrion aprueba solicitudes' });
      return;
    }
    await pool.query(
      `UPDATE board_members SET rol = 'editor'
        WHERE board_id = $1 AND usuario_id = $2 AND rol = 'pendiente'`,
      [req.params.id, req.params.uid]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

boardsRouter.post('/boards/:id/pendientes/:uid/rechazar', async (req, res, next) => {
  try {
    const usuarioId = idDe(req);
    if (!usuarioId) {
      res.status(401).json({ error: 'Necesitas iniciar sesion' });
      return;
    }
    const acceso = await accesoAPizarra(String(req.params.id), usuarioId);
    if (!acceso || !acceso.esPropietario) {
      res.status(403).json({ error: 'Solo el anfitrion rechaza solicitudes' });
      return;
    }
    await pool.query(
      `DELETE FROM board_members
        WHERE board_id = $1 AND usuario_id = $2 AND rol = 'pendiente'`,
      [req.params.id, req.params.uid]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** El rol propio en una pizarra: al invitado en espera le dice si ya lo aprobaron. */
boardsRouter.get('/boards/:id/mi-rol', async (req, res, next) => {
  try {
    const usuarioId = idDe(req);
    if (!usuarioId) {
      res.status(401).json({ error: 'Necesitas iniciar sesion' });
      return;
    }
    const { rows } = await pool.query<{ rol: string }>(
      'SELECT rol FROM board_members WHERE board_id = $1 AND usuario_id = $2',
      [req.params.id, usuarioId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'No sos miembro de esta pizarra' });
      return;
    }
    res.json({ rol: rows[0].rol });
  } catch (err) {
    next(err);
  }
});

boardsRouter.delete('/boards/:id/miembros/:uid', async (req, res, next) => {
  try {
    const usuarioId = idDe(req);
    if (!usuarioId) {
      res.status(401).json({ error: 'Necesitas iniciar sesion' });
      return;
    }
    const acceso = await accesoAPizarra(String(req.params.id), usuarioId);
    if (!acceso || !acceso.esPropietario) {
      res.status(403).json({ error: 'Solo el anfitrion puede expulsar participantes' });
      return;
    }
    // No se puede echar a uno mismo
    if (usuarioId === req.params.uid) {
      res.status(400).json({ error: 'No puedes expulsarte a ti mismo' });
      return;
    }
    await pool.query(
      `DELETE FROM board_members
        WHERE board_id = $1 AND usuario_id = $2`,
      [req.params.id, req.params.uid]
    );

    // Expulsar al usuario del websocket activo
    const { kickParticipant } = await import('../ws.js');
    const { rows } = await pool.query<{ diagram_id: string }>(
      'SELECT diagram_id FROM boards WHERE id = $1',
      [req.params.id]
    );
    if (rows.length > 0) {
      kickParticipant(rows[0].diagram_id, req.params.uid);
    }

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
