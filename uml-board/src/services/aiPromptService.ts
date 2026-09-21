import { api } from '../lib/apiClient';
import type { EdgeType, NodeType } from '../utils/umlConstants';

/**
 * Asistente UML.
 *
 * El prompt y las credenciales viven en el backend (server/src/ai/), no aqui:
 *  - no hay ninguna clave de API en el navegador
 *  - el mismo endpoint sirve al escritorio y a la PWA de voz
 *  - el backend decide IA local (Ollama) o nube (OpenAI) segun AI_STRATEGY
 */

export interface DiagramAction {
  type: 'create' | 'update' | 'delete';
  target: 'class' | 'attribute' | 'edge';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface PromptResult {
  actions: DiagramAction[];
  /** Que proveedor respondio: se muestra en la UI para evidenciar local vs nube. */
  provider: string;
  model: string;
  /** 'dominio' cuando la IA modelo un negocio completo, 'atomico' cuando fue una edicion puntual. */
  modo: string;
}

export const processUMLPromptDetailed = async (
  prompt: string,
  currentNodes: NodeType[],
  currentEdges: EdgeType[]
): Promise<PromptResult> => {
  // Contexto compacto: solo lo que el modelo necesita para referenciar lo existente.
  const classes = currentNodes.map(n => ({
    id: n.id,
    nombre: n.label,
    atributos: (n.attributes ?? []).map(a => `${a.name}: ${a.datatype} (${a.scope})`),
    asociativa: n.asociativa ?? false,
  }));

  const relations = currentEdges.map(e => ({
    id: e.id,
    desde: currentNodes.find(n => n.id === e.source)?.label ?? 'desconocido',
    hacia: currentNodes.find(n => n.id === e.target)?.label ?? 'desconocido',
    tipo: e.tipo,
    multiplicidad: `${e.multiplicidadOrigen}:${e.multiplicidadDestino}`,
  }));

  try {
    const res = await api.umlActions(prompt, classes, relations);
    const actions = (res.actions ?? []) as DiagramAction[];
    const modo = typeof res.modo === 'string' ? res.modo : 'atomico';
    console.log(`[ia] ${actions.length} accion(es) via ${res.provider} (${res.model}) [modo ${modo}]`);
    return { actions, provider: res.provider, model: res.model, modo };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    throw new Error(
      `No se pudo procesar la instruccion: ${message}. ` +
        'Verifica que el servidor este corriendo (npm run dev en server/) y que haya ' +
        'IA disponible: Ollama local o OPENAI_API_KEY en server/.env'
    );
  }
};

/** Firma original, mantenida para el codigo que ya la usaba. */
export const processUMLPrompt = async (
  prompt: string,
  currentNodes: NodeType[],
  currentEdges: EdgeType[]
): Promise<DiagramAction[]> =>
  (await processUMLPromptDetailed(prompt, currentNodes, currentEdges)).actions;

/**
 * Antes comprobaba que hubiera un token 'sk-...' en el codigo del navegador.
 * Ahora la disponibilidad la reporta el servidor, que es quien tiene las credenciales.
 */
export async function isAiAvailable(): Promise<boolean> {
  try {
    const status = await api.aiStatus();
    return status.local.available || status.cloud.available;
  } catch {
    return false;
  }
}
