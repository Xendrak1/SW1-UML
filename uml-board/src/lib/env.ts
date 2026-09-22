/** Configuracion del cliente. Todo sale de variables de entorno: no hay credenciales en el codigo. */
const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

// Cadena vacia (build de la nube: VITE_API_URL=""): la API vive en el mismo
// origen que el frontend, asi que se usan URLs relativas. Indefinido
// (desarrollo sin .env): default local.
export const API_URL = rawApiUrl === undefined ? 'http://localhost:4000' : rawApiUrl.replace(/\/+$/, '');

/**
 * URL del WebSocket. Con API relativa (mismo origen) se deriva del origen de la
 * pagina; con API absoluta (desarrollo) se deriva de la URL del API.
 */
export const WS_URL =
  API_URL === ''
    ? `${typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws'}://${
        typeof location !== 'undefined' ? location.host : 'localhost:4000'
      }/ws`
    : `${API_URL.replace(/^http/, 'ws')}/ws`;
