import { API_URL } from './env';
import { cerrarSesion, tokenActual } from './sesion';
import { cabecerasDeIa } from './ajustesIa';
import {
  accionesConModeloLocal,
  imagenConModeloLocal,
  preguntaConModeloLocal,
  resolverCamino,
} from './iaRelevo';
import type { DiagramDoc } from './collabTypes';

/** Cliente REST del backend propio. Reemplaza por completo al cliente de Supabase. */

export interface Invitacion {
  token: string;
  boardId: string;
  rol: 'editor' | 'lector';
  expiraEn: string;
  usosMax: number;
  usos: number;
}

export interface BoardRow {
  id: string;
  name: string;
  diagram_id: string;
  created_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = tokenActual();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    // El token vencio o dejo de ser valido: se limpia para que la aplicacion
    // vuelva a la pantalla de acceso en vez de fallar en cada peticion.
    cerrarSesion();
    throw new Error('Tu sesion expiro. Volve a iniciar sesion.');
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // El backend devuelve {"error": "..."} con un mensaje pensado para leerse.
    // Mostrarlo tal cual evita el "500 Internal Server Error - {\"error\":..."
    // que aparecia en la alerta del navegador.
    let mensaje = '';
    try {
      const j = JSON.parse(detail) as { error?: string };
      if (typeof j.error === 'string') mensaje = j.error;
    } catch {
      /* no era JSON */
    }
    if (mensaje) throw new Error(mensaje);
    throw new Error(`${res.status} ${res.statusText}${detail ? ` - ${detail}` : ''}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const SIN_IA =
  'Tenes la IA desactivada en Ajustes de IA. Activala eligiendo tu Ollama local o ' +
  'poniendo la clave de un proveedor en la nube.';

export const api = {
  health: () => request<{ ok: boolean; db: string }>('/health'),

  listBoards: () => request<BoardRow[]>('/api/boards'),
  createBoard: (name: string) =>
    request<BoardRow>('/api/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  renameBoard: (id: string, name: string) =>
    request<BoardRow>(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteBoard: (id: string) => request<void>(`/api/boards/${id}`, { method: 'DELETE' }),

  /**
   * Enlaces de invitacion. Reemplazan al codigo de registro unico: el anfitrion
   * invita a SU pizarra, con un rol y un vencimiento, y lo puede revocar.
   */
  crearInvitacion: (boardId: string, opciones: { rol?: 'editor' | 'lector'; dias?: number; usosMax?: number } = {}) =>
    request<Invitacion>(`/api/boards/${boardId}/invitaciones`, {
      method: 'POST',
      body: JSON.stringify(opciones),
    }),
  listarInvitaciones: (boardId: string) =>
    request<Invitacion[]>(`/api/boards/${boardId}/invitaciones`),
  revocarInvitacion: (boardId: string, token: string) =>
    request<void>(`/api/boards/${boardId}/invitaciones/${encodeURIComponent(token)}`, {
      method: 'DELETE',
    }),
  /** Vista previa publica: quien abre el enlace todavia no tiene cuenta. */
  verInvitacion: (token: string) =>
    request<{ pizarra: string; rol: string; expiraEn: string }>(
      `/api/auth/invitacion/${encodeURIComponent(token)}`
    ),
  aceptarInvitacion: (token: string) =>
    request<{ boardId: string; rol: string; pizarra: string }>(
      `/api/invitaciones/${encodeURIComponent(token)}/aceptar`,
      { method: 'POST' }
    ),

  getPendientes: (boardId: string) =>
    request<Array<{ usuario_id: string; nombre: string; correo: string; created_at: string }>>(
      `/api/boards/${boardId}/pendientes`
    ),
  aprobarPendiente: (boardId: string, usuarioId: string) =>
    request<void>(`/api/boards/${boardId}/pendientes/${encodeURIComponent(usuarioId)}/aprobar`, {
      method: 'POST',
    }),
  rechazarPendiente: (boardId: string, usuarioId: string) =>
    request<void>(`/api/boards/${boardId}/pendientes/${encodeURIComponent(usuarioId)}/rechazar`, {
      method: 'POST',
    }),
  expulsarMiembro: (boardId: string, usuarioId: string) =>
    request<void>(`/api/boards/${boardId}/miembros/${encodeURIComponent(usuarioId)}`, {
      method: 'DELETE',
    }),

  getDiagram: (id: string) => request<{ id: string; doc: DiagramDoc; seq: number }>(`/api/diagrams/${id}`),
  getOps: (id: string, since = 0) => request<unknown[]>(`/api/diagrams/${id}/ops?since=${since}`),

  aiStatus: () =>
    request<{
      strategy: 'local' | 'cloud' | 'hybrid';
      local: {
        available: boolean;
        baseUrl: string;
        model: string;
        visionModel: string;
        /** Modelos realmente descargados en Ollama. */
        instalados?: string[];
        modelInstalado?: boolean;
        visionModelInstalado?: boolean;
      };
      cloud: { available: boolean; model: string; visionModel: string };
    }>('/api/ai/status'),

  /**
   * Instruccion en lenguaje natural -> acciones sobre el diagrama.
   *
   * El camino lo eligen los ajustes del usuario: su propio Ollama (el navegador
   * hace de puente), su clave de la nube, o lo que tenga configurado el
   * servidor. Quien llama no se entera: siempre recibe la misma forma.
   */
  umlActions: async (prompt: string, classes: unknown, relations: unknown) => {
    type Respuesta = {
      actions: unknown[];
      provider: string;
      model: string;
      modo?: string;
      rescatado?: boolean;
      descartadas?: string[];
    };
    const camino = await resolverCamino();
    if (camino === 'sin-ia') throw new Error(SIN_IA);
    if (camino === 'local') {
      return (await accionesConModeloLocal(prompt, classes, relations)) as unknown as Respuesta;
    }
    return request<Respuesta>('/api/ai/uml-actions', {
      method: 'POST',
      headers: cabecerasDeIa(),
      body: JSON.stringify({ prompt, classes, relations }),
    });
  },

  /**
   * Sube un proyecto de Enterprise Architect (.eapx) y devuelve sus diagramas
   * de clases. El archivo va como multipart, no como JSON: es binario.
   */
  importarEapx: (archivo: File) => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    return request<{
      herramienta: string;
      archivo: string;
      total: number;
      diagramas: Array<{
        id: string;
        nombre: string;
        tipo: string;
        paquete: string;
        clases: unknown[];
        conectores: unknown[];
      }>;
    }>('/api/case/eapx', { method: 'POST', body: fd });
  },

  /** Pregunta libre con contexto acotado; devuelve texto. La usa la guia de usuario. */
  ask: async (question: string, context: string) => {
    type Respuesta = { answer: string; provider: string; model: string };
    const camino = await resolverCamino();
    if (camino === 'sin-ia') throw new Error(SIN_IA);
    if (camino === 'local') {
      return (await preguntaConModeloLocal(question, context)) as unknown as Respuesta;
    }
    return request<Respuesta>('/api/ai/ask', {
      method: 'POST',
      headers: cabecerasDeIa(),
      body: JSON.stringify({ question, context }),
    });
  },

  imageToUml: async (file: File | Blob) => {
    const camino = await resolverCamino();
    if (camino === 'sin-ia') throw new Error(SIN_IA);
    if (camino === 'local') {
      return (await imagenConModeloLocal(file)) as unknown as {
        classes: Array<{
          label: string;
          attributes?: Array<{ name: string; datatype: string; scope: string }>;
          asociativa?: boolean;
          relaciona?: [string, string];
        }>;
        relations: Array<{
          sourceLabel: string;
          targetLabel: string;
          tipo: string;
          multiplicidadOrigen: string;
          multiplicidadDestino: string;
        }>;
        provider: string;
        model: string;
      };
    }
    const form = new FormData();
    form.append('image', file);
    return request<{
      classes: Array<{
        label: string;
        attributes?: Array<{ name: string; datatype: string; scope: string }>;
        asociativa?: boolean;
        relaciona?: [string, string];
      }>;
      relations: Array<{
        sourceLabel: string;
        targetLabel: string;
        tipo: string;
        multiplicidadOrigen: string;
        multiplicidadDestino: string;
      }>;
      provider: string;
      model: string;
    }>('/api/ai/image-to-uml', { method: 'POST', headers: cabecerasDeIa(), body: form });
  },

  uploadFile: (file: File | Blob) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ filename: string; url: string; size: number }>('/api/uploads', {
      method: 'POST',
      body: form,
    });
  },
  listUploads: () =>
    request<Array<{ filename: string; mime_type: string; size_bytes: string; url: string }>>(
      '/api/uploads'
    ),

  fileUrl: (path: string) => `${API_URL}${path}`,
};
