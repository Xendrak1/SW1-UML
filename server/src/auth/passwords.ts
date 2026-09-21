import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Hash de contrasenas con scrypt.
 *
 * scrypt viene en node:crypto, asi que no hace falta una dependencia nativa que
 * despues complique el despliegue, y es una funcion de derivacion pensada para
 * contrasenas: es cara a proposito, tanto en CPU como en memoria, que es lo que
 * encarece un ataque por fuerza bruta. Guardar la contrasena en claro, o con un
 * hash rapido como SHA-256, no seria aceptable en un sistema que va a la nube.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opciones: { N: number; r: number; p: number }
) => Promise<Buffer>;

// Parametros de uso interactivo: alrededor de 64 MB de memoria por calculo.
const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

export async function hashPassword(password: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scryptAsync(password, sal, LARGO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarPassword(password: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, salB64, hashB64] = partes;
  try {
    const sal = Buffer.from(salB64, 'base64');
    const esperado = Buffer.from(hashB64, 'base64');
    const calculado = await scryptAsync(password, sal, esperado.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    // Comparacion en tiempo constante: una comparacion normal filtra, por lo que
    // tarda en fallar, cuantos bytes del hash coincidian.
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
  } catch {
    return false;
  }
}
