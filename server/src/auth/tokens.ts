import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

/**
 * Tokens de sesion en formato JWT con firma HS256.
 *
 * Se implementa con node:crypto en vez de traer una libreria: son treinta
 * lineas, el formato esta cerrado por el RFC 7519 y asi no hay una dependencia
 * mas que auditar. El token lleva el id del usuario y su vencimiento, va
 * firmado con el secreto del servidor, y cualquier cambio en el contenido
 * invalida la firma.
 *
 * El secreto vive en AUTH_SECRET dentro de server/.env. Si no esta configurado
 * el servidor no arranca: un secreto por defecto en el codigo seria lo mismo
 * que no tener firma, porque cualquiera que vea el repositorio puede emitir
 * tokens validos.
 */

export interface Sesion {
  /** id del usuario */
  sub: string;
  correo: string;
  nombre: string;
  /** vencimiento, en segundos desde epoch */
  exp: number;
}

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const deB64url = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const firmar = (datos: string): string =>
  b64url(createHmac('sha256', config.auth.secret).update(datos).digest());

/** Vigencia del token. Una semana: comodo para el uso en clase, corto para un robo. */
export const DURACION_SEGUNDOS = 7 * 24 * 60 * 60;

export function emitirToken(usuario: { id: string; correo: string; nombre: string }): string {
  const cabecera = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const cuerpo: Sesion = {
    sub: usuario.id,
    correo: usuario.correo,
    nombre: usuario.nombre,
    exp: Math.floor(Date.now() / 1000) + DURACION_SEGUNDOS,
  };
  const carga = b64url(Buffer.from(JSON.stringify(cuerpo)));
  return `${cabecera}.${carga}.${firmar(`${cabecera}.${carga}`)}`;
}

/** Devuelve la sesion si el token es valido y no vencio; null en cualquier otro caso. */
export function verificarToken(token: string): Sesion | null {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cabecera, carga, firma] = partes;

  const esperada = firmar(`${cabecera}.${carga}`);
  const a = deB64url(firma);
  const b = deB64url(esperada);
  // Comparacion en tiempo constante, por el mismo motivo que en las contrasenas.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const alg = JSON.parse(deB64url(cabecera).toString()) as { alg?: string };
    // Rechazar "alg": "none" y cualquier algoritmo distinto es lo que evita el
    // ataque clasico de confusion de algoritmo contra JWT.
    if (alg.alg !== 'HS256') return null;

    const sesion = JSON.parse(deB64url(carga).toString()) as Sesion;
    if (typeof sesion.sub !== 'string' || sesion.sub === '') return null;
    if (typeof sesion.exp !== 'number' || sesion.exp * 1000 < Date.now()) return null;
    return sesion;
  } catch {
    return null;
  }
}
