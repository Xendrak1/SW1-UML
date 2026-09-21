import { Router } from 'express';
import { pool } from '../db.js';
import { hashPassword, verificarPassword } from '../auth/passwords.js';
import { emitirToken, DURACION_SEGUNDOS } from '../auth/tokens.js';
import { requiereSesion } from '../auth/middleware.js';

export const authRouter = Router();

interface FilaUsuario {
  id: string;
  correo: string;
  nombre: string;
  color: string;
  password_hash: string;
}

const COLORES = ['#667eea', '#e07a5f', '#2a9d8f', '#8e7dbe', '#e9c46a', '#4ea8de'];

const normalizarCorreo = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/**
 * El mensaje de error del registro es distinto del de inicio de sesion a
 * proposito: aca el usuario necesita saber que el correo ya existe, y de todas
 * formas el registro ya revela esa informacion por su naturaleza.
 */
authRouter.post('/registro', async (req, res, next) => {
  try {
    const correo = normalizarCorreo(req.body?.correo);
    const nombre = String(req.body?.nombre ?? '').trim();
    const password = String(req.body?.password ?? '');

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      res.status(400).json({ error: 'El correo no tiene un formato valido' });
      return;
    }
    if (nombre.length < 2) {
      res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres' });
      return;
    }

    const hash = await hashPassword(password);
    const color = COLORES[Math.floor(Math.random() * COLORES.length)];

    const { rows } = await pool.query<FilaUsuario>(
      `INSERT INTO usuarios (correo, nombre, password_hash, color)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (correo) DO NOTHING
       RETURNING id, correo, nombre, color, password_hash`,
      [correo, nombre, hash, color]
    );
    if (rows.length === 0) {
      res.status(409).json({ error: 'Ya hay una cuenta con ese correo' });
      return;
    }

    const u = rows[0];
    res.status(201).json({
      token: emitirToken(u),
      expiraEn: DURACION_SEGUNDOS,
      usuario: { id: u.id, correo: u.correo, nombre: u.nombre, color: u.color },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const correo = normalizarCorreo(req.body?.correo);
    const password = String(req.body?.password ?? '');

    const { rows } = await pool.query<FilaUsuario>(
      'SELECT id, correo, nombre, color, password_hash FROM usuarios WHERE correo = $1',
      [correo]
    );

    // Un solo mensaje para "no existe" y "contrasena incorrecta": decir cual de
    // los dos fue permite averiguar que correos tienen cuenta.
    const generico = { error: 'Correo o contrasena incorrectos' };

    if (rows.length === 0) {
      // Se verifica igual contra un hash descartable para que la respuesta tarde
      // lo mismo que con un usuario existente y no se pueda distinguir por tiempo.
      await verificarPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      res.status(401).json(generico);
      return;
    }

    const u = rows[0];
    if (!(await verificarPassword(password, u.password_hash))) {
      res.status(401).json(generico);
      return;
    }

    res.json({
      token: emitirToken(u),
      expiraEn: DURACION_SEGUNDOS,
      usuario: { id: u.id, correo: u.correo, nombre: u.nombre, color: u.color },
    });
  } catch (err) {
    next(err);
  }
});

/** Quien soy. La usa el frontend al arrancar para saber si el token sigue vivo. */
authRouter.get('/yo', requiereSesion, async (req, res, next) => {
  try {
    if (!req.sesion) {
      res.status(401).json({ error: 'Necesitas iniciar sesion' });
      return;
    }
    const { rows } = await pool.query<FilaUsuario>(
      'SELECT id, correo, nombre, color FROM usuarios WHERE id = $1',
      [req.sesion.sub]
    );
    if (rows.length === 0) {
      // El token es valido pero la cuenta ya no existe.
      res.status(401).json({ error: 'La cuenta ya no existe' });
      return;
    }
    const u = rows[0];
    res.json({ usuario: { id: u.id, correo: u.correo, nombre: u.nombre, color: u.color } });
  } catch (err) {
    next(err);
  }
});
