import { API_URL } from './env';

/**
 * Sesion del usuario en el navegador.
 *
 * El token se guarda en localStorage. Es una decision con un compromiso: una
 * cookie HttpOnly seria inaccesible para un script y por lo tanto mas segura
 * ante XSS, pero el WebSocket y el frontend servido aparte necesitan leer el
 * token para mandarlo, y una cookie de sesion entre dominios distintos trae su
 * propia complicacion. La contrapartida se mitiga no teniendo HTML de terceros
 * en la aplicacion y con un token de vida acotada.
 */

export interface Usuario {
  id: string;
  correo: string;
  nombre: string;
  color: string;
}

const CLAVE = 'case.sesion';

interface Guardado {
  token: string;
  usuario: Usuario;
}

let cache: Guardado | null = null;

export function sesionActual(): Guardado | null {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(CLAVE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Guardado>;
    if (typeof parsed.token === 'string' && parsed.usuario?.id) {
      cache = parsed as Guardado;
      return cache;
    }
  } catch {
    /* localStorage bloqueado: se trabaja sin sesion guardada */
  }
  return null;
}

export const tokenActual = (): string | null => sesionActual()?.token ?? null;
export const usuarioActual = (): Usuario | null => sesionActual()?.usuario ?? null;

function guardar(datos: Guardado): Usuario {
  cache = datos;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  } catch {
    /* sin persistencia, pero la sesion de esta pestana funciona */
  }
  return datos.usuario;
}

export function cerrarSesion(): void {
  cache = null;
  try {
    localStorage.removeItem(CLAVE);
  } catch {
    /* ignorado */
  }
}

async function pedir(ruta: string, cuerpo: unknown): Promise<Usuario> {
  const res = await fetch(`${API_URL}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const datos = (await res.json().catch(() => ({}))) as Partial<Guardado> & { error?: string };
  if (!res.ok) throw new Error(datos.error ?? `Error ${res.status}`);
  if (!datos.token || !datos.usuario) throw new Error('El servidor no devolvio la sesion');
  return guardar({ token: datos.token, usuario: datos.usuario });
}

export const iniciarSesion = (correo: string, password: string): Promise<Usuario> =>
  pedir('/api/auth/login', { correo, password });

export const registrarse = (nombre: string, correo: string, password: string): Promise<Usuario> =>
  pedir('/api/auth/registro', { nombre, correo, password });

/**
 * Comprueba contra el servidor que el token siga siendo valido. Se llama al
 * arrancar: un token vencido guardado en el navegador haria que la aplicacion
 * pareciera abierta y despues fallara cada peticion.
 */
export async function validarSesion(): Promise<Usuario | null> {
  const s = sesionActual();
  if (!s) return null;
  try {
    const res = await fetch(`${API_URL}/api/auth/yo`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    if (res.status === 401) {
      cerrarSesion();
      return null;
    }
    if (!res.ok) return s.usuario; // el servidor no responde: no se borra la sesion
    const datos = (await res.json()) as { usuario?: Usuario };
    if (datos.usuario) return guardar({ token: s.token, usuario: datos.usuario });
    return s.usuario;
  } catch {
    // Sin red: se conserva la sesion, que es justo lo que permite trabajar offline.
    return s.usuario;
  }
}
