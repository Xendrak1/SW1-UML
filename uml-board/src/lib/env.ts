/** Configuracion del cliente. Todo sale de variables de entorno: no hay credenciales en el codigo. */
const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

export const API_URL = (rawApiUrl && rawApiUrl.replace(/\/$/, '')) || 'http://localhost:4000';

/** URL del WebSocket derivada de la del API: http -> ws, https -> wss. */
export const WS_URL = `${API_URL.replace(/^http/, 'ws')}/ws`;
