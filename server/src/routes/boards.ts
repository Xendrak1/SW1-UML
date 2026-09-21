import { Router } from 'express';
import { pool } from '../db.js';
import { forgetRoom, getOpsSince, getSnapshot } from '../rooms.js';
import { plantillaInicial } from '../case/plantillaInicial.js';
import { accesoADiagrama, accesoAPizarra, registrarMiembro } from '../auth/acceso.js';

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
