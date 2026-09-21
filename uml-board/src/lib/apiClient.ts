import { API_URL } from './env';
import { cerrarSesion, tokenActual } from './sesion';
import type { DiagramDoc } from './collabTypes';

/** Cliente REST del backend propio. Reemplaza por completo al cliente de Supabase. */

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

export const api = {
  health: () => request<{ ok: boolean; db: string }>('/health'),

  listBoards: () => request<BoardRow[]>('/api/boards'),
  createBoard: (name: string) =>
    request<BoardRow>('/api/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  renameBoard: (id: string, name: string) =>
    request<BoardRow>(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteBoard: (id: string) => request<void>(`/api/boards/${id}`, { method: 'DELETE' }),

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

  umlActions: (prompt: string, classes: unknown, relations: unknown) =>
    request<{ actions: unknown[]; provider: string; model: string; modo?: string; rescatado?: boolean; descartadas?: string[] }>('/api/ai/uml-actions', {
      method: 'POST',
      body: JSON.stringify({ prompt, classes, relations }),
    }),

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
  ask: (question: string, context: string) =>
    request<{ answer: string; provider: string; model: string }>('/api/ai/ask', {
      method: 'POST',
      body: JSON.stringify({ question, context }),
    }),

  imageToUml: (file: File | Blob) => {
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
    }>('/api/ai/image-to-uml', { method: 'POST', body: form });
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
