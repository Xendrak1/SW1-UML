import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { verificarToken, type Sesion } from './tokens.js';

/**
 * Autenticacion de las peticiones REST.
 *
 * El token viaja en la cabecera Authorization como "Bearer <token>", que es lo
 * estandar y evita mandarlo en la URL, donde quedaria registrado en los logs
 * del servidor y del proxy.
 */

declare module 'express-serve-static-core' {
  interface Request {
    sesion?: Sesion;
  }
}

export function leerSesion(req: Request): Sesion | null {
  const cabecera = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(String(cabecera));
  if (!m) return null;
  return verificarToken(m[1]);
}

/** Exige una sesion valida. Responde 401 si no la hay. */
export function requiereSesion(req: Request, res: Response, next: NextFunction): void {
  const sesion = leerSesion(req);
  if (sesion) {
    req.sesion = sesion;
    next();
    return;
  }
  if (!config.auth.requerida) {
    // Perilla de emergencia: ver config.auth.requerida.
    next();
    return;
  }
  res.status(401).json({ error: 'Necesitas iniciar sesion' });
}
