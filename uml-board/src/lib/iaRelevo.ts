/**
 * El navegador como puente hacia el Ollama de esta maquina.
 *
 * El servidor de la nube no puede llegar a un modelo que corre en localhost del
 * usuario: localhost, desde AWS, es AWS. Pero esta pagina si, porque ya se esta
 * ejecutando en la maquina donde el modelo vive.
 *
 * Lo que NO se hace aca es duplicar la logica de la IA. El servidor sigue
 * decidiendo que prompt se manda, cuantas etapas tiene el flujo y que se acepta
 * de la respuesta; este modulo pide el prompt, se lo pasa a Ollama y devuelve el
 * texto crudo. Si la logica estuviera en los dos lados, la primera correccion
 * que se hiciera en uno dejaria al otro mintiendo.
 */
import { API_URL } from './env';
import { tokenActual } from './sesion';
import { leerAjustesIa, caminoPedido, type AjustesIa, type Camino } from './ajustesIa';

export interface PeticionModelo {
  system: string;
  user: string;
  imageBase64?: string;
  numCtx?: number;
  numPredict?: number;
  temperature?: number;
}

interface PasoRelevo {
  sesion?: string;
  peticion?: PeticionModelo;
  listo?: boolean;
  [k: string]: unknown;
}

/** Cuanto se espera a que el modelo local conteste. Un 7B tarda. */
const TIMEOUT_MODELO_MS = 180_000;
const TIMEOUT_SONDEO_MS = 2000;

async function postRelevo(ruta: string, cuerpo: unknown): Promise<PasoRelevo> {
  const token = tokenActual();
  const res = await fetch(`${API_URL}${ruta}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(cuerpo),
  });
  const datos = (await res.json().catch(() => ({}))) as PasoRelevo & { error?: string };
  if (!res.ok) throw new Error(datos.error ?? `El servidor respondio ${res.status}`);
  return datos;
}

/** Le pregunta a Ollama si esta levantado. Se usa para el modo automatico. */
export async function ollamaDisponible(url = leerAjustesIa().ollamaUrl): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_SONDEO_MS);
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/** Modelos descargados en el Ollama de esta maquina. */
export async function modelosLocales(url = leerAjustesIa().ollamaUrl): Promise<string[]> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/api/tags`);
    if (!res.ok) return [];
    const datos = (await res.json()) as { models?: Array<{ name?: string }> };
    return (datos.models ?? []).map(m => m.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resuelve el modo automatico: la IA local primero porque es gratis y no manda
 * el diagrama a ningun tercero; la nube del usuario si tiene clave; y si no hay
 * ninguna de las dos, que decida el servidor como siempre.
 */
export async function resolverCamino(ajustes: AjustesIa = leerAjustesIa()): Promise<Camino> {
  const pedido = caminoPedido(ajustes);
  if (pedido !== 'auto') return pedido;
  if (await ollamaDisponible(ajustes.ollamaUrl)) return 'local';
  return ajustes.claveNube.trim() !== '' ? 'nube' : 'servidor';
}

const sinBarra = (u: string): string => u.replace(/\/+$/, '');

/** Una llamada al Ollama de esta maquina. Devuelve el texto tal cual. */
async function preguntarAOllama(p: PeticionModelo, ajustes: AjustesIa): Promise<string> {
  const modelo = p.imageBase64 ? ajustes.ollamaModeloVision : ajustes.ollamaModelo;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MODELO_MS);
  try {
    const res = await fetch(`${sinBarra(ajustes.ollamaUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: modelo,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: p.system },
          {
            role: 'user',
            content: p.user,
            ...(p.imageBase64 ? { images: [p.imageBase64] } : {}),
          },
        ],
        options: {
          temperature: p.temperature ?? 0.1,
          // El mismo num_ctx que usa el servidor: con el valor por defecto de
          // Ollama, el contexto se recorta en silencio y el modelo contesta una
          // fraccion de lo que se le pidio.
          num_ctx: p.numCtx ?? 8192,
          num_predict: p.numPredict ?? 4096,
        },
      }),
    });
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => '');
      if (res.status === 404) {
        throw new Error(
          `Tu Ollama no tiene el modelo "${modelo}". Descargalo con:  ollama pull ${modelo}`
        );
      }
      throw new Error(`Ollama respondio ${res.status}: ${cuerpo.slice(0, 200)}`);
    }
    const datos = (await res.json()) as { message?: { content?: string } };
    const texto = datos.message?.content;
    if (typeof texto !== 'string' || texto.trim() === '') {
      throw new Error('Tu Ollama devolvio una respuesta vacia');
    }
    return texto;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Tu Ollama tardo demasiado en contestar');
    }
    if (err instanceof TypeError) {
      // fetch a localhost que no responde: el caso mas comun y el que mas
      // confunde, porque el mensaje del navegador no dice nada util.
      throw new Error(
        `No se pudo hablar con tu Ollama en ${ajustes.ollamaUrl}. ` +
          'Comproba que este corriendo ("ollama serve") y que permita a esta pagina ' +
          `(OLLAMA_ORIGINS=${location.origin}).`
      );
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Conduce un flujo completo contra el modelo local.
 *
 * El bucle es el mismo que corre el servidor cuando la IA la resuelve el: pedir
 * el siguiente prompt, contestarlo, repetir hasta que diga que termino.
 */
async function conducir(
  inicio: PasoRelevo,
  ajustes: AjustesIa,
  avisar?: (paso: number) => void
): Promise<Record<string, unknown>> {
  let paso = inicio;
  let n = 0;
  while (!paso.listo) {
    if (!paso.peticion || !paso.sesion) {
      throw new Error('El servidor no devolvio la siguiente peticion de IA');
    }
    n += 1;
    avisar?.(n);
    const texto = await preguntarAOllama(paso.peticion, ajustes);
    paso = await postRelevo('/api/ai/relevo/paso', { sesion: paso.sesion, texto });
  }
  // Se saca la bandera de control: quien llama espera la misma forma de
  // respuesta que devuelve el servidor cuando resuelve la IA el, sin extras.
  const resto: Record<string, unknown> = { ...paso };
  delete resto.listo;
  delete resto.sesion;
  return resto;
}

/** Instruccion en lenguaje natural, resuelta con el modelo de esta maquina. */
export async function accionesConModeloLocal(
  prompt: string,
  classes: unknown,
  relations: unknown,
  avisar?: (paso: number) => void
): Promise<Record<string, unknown>> {
  const ajustes = leerAjustesIa();
  const inicio = await postRelevo('/api/ai/relevo/iniciar', {
    tipo: 'acciones',
    prompt,
    classes,
    relations,
  });
  return conducir(inicio, ajustes, avisar);
}

/** Pregunta de la guia de usuario, resuelta con el modelo de esta maquina. */
export async function preguntaConModeloLocal(
  question: string,
  context: string
): Promise<Record<string, unknown>> {
  const ajustes = leerAjustesIa();
  const inicio = await postRelevo('/api/ai/relevo/iniciar', { tipo: 'pregunta', question, context });
  return conducir(inicio, ajustes);
}

/** Foto de un diagrama, resuelta con el modelo de vision de esta maquina. */
export async function imagenConModeloLocal(
  archivo: File | Blob,
  avisar?: (paso: number) => void
): Promise<Record<string, unknown>> {
  const ajustes = leerAjustesIa();
  const token = tokenActual();
  const form = new FormData();
  form.append('image', archivo);
  const res = await fetch(`${API_URL}/api/ai/relevo/iniciar-imagen`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const inicio = (await res.json().catch(() => ({}))) as PasoRelevo & { error?: string };
  if (!res.ok) throw new Error(inicio.error ?? `El servidor respondio ${res.status}`);
  return conducir(inicio, ajustes, avisar);
}
