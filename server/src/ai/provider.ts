import { config } from '../config.js';

export interface ChatRequest {
  system: string;
  user: string;
  /** Imagen en base64 (sin el prefijo data:) para los modelos con vision. */
  imageBase64?: string;
  temperature?: number;
  /** Ventana de contexto del modelo local. Ver la nota en ollamaChat. */
  numCtx?: number;
  /** Tope de tokens generados. */
  numPredict?: number;
}

/**
 * De donde sale el modelo para ESTA peticion.
 *
 * Existe para que cada usuario pueda poner su propia clave en la interfaz en vez
 * de depender de una sola clave del servidor. La clave llega por cabecera, se
 * usa en la llamada y se descarta: no se escribe en la base ni en el log. Si el
 * credito de una clave se agota, es problema de ese usuario y no tumba la IA
 * para todos, que es lo que pasaba con la clave unica del entorno.
 */
export interface Motor {
  apiKey: string;
  baseUrl?: string;
  modelo?: string;
  modeloVision?: string;
  /**
   * Identificador estable de la conversacion. Algunos proveedores lo piden para
   * rutear y cachear (OpenCode Go rechaza la peticion sin el). Lo genera el
   * cliente y se mantiene mientras dure el trabajo sobre una misma pizarra.
   */
  sesion?: string;
}

/**
 * Como se presenta esta aplicacion ante el proveedor.
 *
 * Va con el nombre real de la herramienta a proposito: las pasarelas que
 * condicionan el acceso al tipo de cliente esperan poder identificar quien las
 * llama, y hacerse pasar por otro cliente para esquivar ese control es
 * exactamente lo que miran. Si un proveedor decide que esta app no entra, la
 * respuesta correcta es cambiar de proveedor, no de disfraz.
 */
export const USER_AGENT = 'case-uml-colaborativa/1.0 (herramienta CASE de modelado UML)';

/**
 * La URL del proveedor la elige el usuario, asi que hay que acotarla: sin esto,
 * el servidor se convierte en un proxy para pedir cualquier cosa desde su red
 * (SSRF). Solo https y nada de direcciones internas.
 */
export function validarBaseUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('La URL del proveedor de IA no es valida');
  }
  if (u.protocol !== 'https:') {
    throw new Error('La URL del proveedor de IA tiene que ser https');
  }
  const host = u.hostname.toLowerCase();
  const privada =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (privada) {
    throw new Error('La URL del proveedor de IA no puede apuntar a una direccion interna');
  }
  return u.toString();
}

export interface ChatResult {
  text: string;
  /** Que proveedor respondio de verdad. La UI lo muestra para que se vea local vs nube. */
  provider: 'ollama' | 'openai';
  model: string;
}

const TIMEOUT_MS = 180_000;

/**
 * El modelo pedido no esta descargado en Ollama. Se distingue del resto de los
 * fallos porque tiene una solucion concreta -un `ollama pull`- y el mensaje
 * generico "la IA local fallo" no ayudaba a encontrarla.
 */
export class ModeloNoInstaladoError extends Error {
  constructor(public readonly modelo: string) {
    super(
      `El modelo "${modelo}" no esta descargado en Ollama. ` +
        `Corre en una terminal:  ollama pull ${modelo}\n` +
        'Si ya lo tenes con otro nombre, corregi OLLAMA_MODEL u OLLAMA_VISION_MODEL en server/.env ' +
        '(el nombre tiene que coincidir exactamente con el que muestra "ollama list").'
    );
    this.name = 'ModeloNoInstaladoError';
  }
}

/**
 * Codigos en los que reintentar tiene sentido: el proveedor esta saturado o tuvo
 * un problema momentaneo, no hay nada mal en la peticion. Un 401 o un 404 se
 * dejan pasar tal cual, porque reintentarlos solo hace esperar al usuario para
 * darle el mismo error.
 */
const CODIGOS_REINTENTABLES = [429, 500, 502, 503, 504, 529];

/**
 * Techo de tokens para el reintento cuando el modelo se quedo sin presupuesto
 * razonando. Generoso porque la alternativa es que la funcion no ande con esos
 * modelos, pero acotado para que un modelo que se va en loop no salga carisimo.
 */
const MAX_TOKENS_RAZONAMIENTO = 16000;
const ESPERAS_MS = [1000, 2000, 4000];

const esReintentable = (msg: string): boolean =>
  CODIGOS_REINTENTABLES.some(c => msg.includes(`HTTP ${c} `));

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Reintenta con espera creciente lo que el proveedor reporto como transitorio.
 *
 * Sin esto, un "503 high demand" de un segundo rompia la importacion entera y el
 * usuario veia el JSON crudo del proveedor. Tres intentos cubren de sobra un
 * pico de demanda sin hacer esperar de mas cuando el error es de verdad.
 */
async function conReintentos<T>(fn: () => Promise<T>): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i <= ESPERAS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (i === ESPERAS_MS.length || !esReintentable(msg)) throw err;
      console.warn(
        `[ai] el proveedor contesto algo transitorio, reintento ${i + 1}/${ESPERAS_MS.length} ` +
          `en ${ESPERAS_MS[i]}ms: ${msg.slice(0, 120)}`
      );
      await dormir(ESPERAS_MS[i]);
    }
  }
  throw ultimo;
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- Ollama (IA local) ----------------

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${config.ai.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Modelos descargados en Ollama. Vacio si Ollama no esta corriendo. */
export async function listOllamaModels(): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${config.ai.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map(m => m.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

async function ollamaChat(req: ChatRequest): Promise<ChatResult> {
  const model = req.imageBase64 ? config.ai.ollamaVisionModel : config.ai.ollamaModel;
  const data = await pedirAOllama(model, req);
  const text = data?.message?.content;
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Ollama devolvio una respuesta vacia');
  }
  return { text, provider: 'ollama', model };
}

async function pedirAOllama(model: string, req: ChatRequest): Promise<any> {
  try {
    return await fetchJson(`${config.ai.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
      model,
      stream: false,
      // format json obliga al modelo local a devolver JSON parseable, que es lo que
      // consume el asistente de diagramas.
      format: 'json',
      options: {
        temperature: req.temperature ?? 0.1,
        // num_ctx es critico y su default (4096, en algunos modelos 2048) no alcanza.
        // Ollama trunca el contexto EN SILENCIO cuando se pasa: el modelo pierde las
        // reglas y los ejemplos del prompt de sistema y responde cualquier cosa. El
        // sintoma era desconcertante: pedirle el modelo de un negocio completo
        // devolvia una sola clase. Con 8192 entran el prompt, el diagrama actual y
        // una respuesta de una decena de clases.
        num_ctx: req.numCtx ?? 8192,
        num_predict: req.numPredict ?? 4096,
      },
      messages: [
        { role: 'system', content: req.system },
        {
          role: 'user',
          content: req.user,
          ...(req.imageBase64 ? { images: [req.imageBase64] } : {}),
        },
      ],
    }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Ollama responde 404 con "model ... not found, try pulling it first".
    if (/404/.test(msg) && /not found/i.test(msg)) throw new ModeloNoInstaladoError(model);
    throw err;
  }
}

// ---------------- OpenAI (IA en la nube) ----------------

async function openaiChat(req: ChatRequest, motor?: Motor): Promise<ChatResult> {
  const apiKey = motor?.apiKey || config.ai.openaiApiKey;
  if (!apiKey) {
    throw new Error(
      'No hay clave de IA. Ponela en Ajustes de IA dentro de la aplicacion, ' +
        'o configura OPENAI_API_KEY en el servidor.'
    );
  }
  const baseUrl = motor?.baseUrl ? validarBaseUrl(motor.baseUrl) : config.ai.openaiBaseUrl;
  const model = req.imageBase64
    ? motor?.modeloVision || motor?.modelo || config.ai.openaiVisionModel
    : motor?.modelo || config.ai.openaiModel;

  const userContent = req.imageBase64
    ? [
        { type: 'text', text: req.user },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${req.imageBase64}` } },
      ]
    : req.user;

  const cuerpo = (conFormatoJson: boolean) =>
    JSON.stringify({
      model,
      temperature: req.temperature ?? 0.1,
      max_tokens: req.numPredict ?? 4096,
      ...(conFormatoJson ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
    });

  const llamar = (conFormatoJson: boolean) =>
    conReintentos(() =>
      fetchJson(baseUrl, {
        method: 'POST',
          headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': USER_AGENT,
          ...(motor?.sesion ? { 'x-opencode-session': motor.sesion } : {}),
        },
        body: cuerpo(conFormatoJson),
      })
    );

  let data: any;
  try {
    data = await llamar(true);
  } catch (err) {
    // response_format es de OpenAI y no todas las pasarelas compatibles lo
    // aceptan. Si es eso lo que molesta, se reintenta sin el: el prompt ya pide
    // JSON y el validador lo comprueba igual, asi que perderlo cuesta poco y
    // dejar afuera a un proveedor entero cuesta mucho mas.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/response_format|unknown field|unsupported|invalid.*parameter/i.test(msg)) throw err;
    console.warn('[ai] el proveedor no acepta response_format, se reintenta sin el');
    data = await llamar(false);
  }
  let data2 = data;
  const gastoRazonando = (d: any): boolean => {
    const m = d?.choices?.[0]?.message;
    const vacio = typeof m?.content !== 'string' || m.content.trim() === '';
    if (!vacio) return false;
    return (
      (typeof m?.reasoning_content === 'string' && m.reasoning_content.trim() !== '') ||
      d?.choices?.[0]?.finish_reason === 'length'
    );
  };
  // Un modelo de razonamiento puede gastar TODO el presupuesto pensando y no
  // llegar a escribir nada. No es un error del proveedor ni de la clave, asi que
  // no hay excepcion que atrapar: hay que mirar la respuesta y repetir con mas
  // aire. Una sola vez, para no multiplicar el gasto en silencio.
  if (gastoRazonando(data2) && (req.numPredict ?? 4096) < MAX_TOKENS_RAZONAMIENTO) {
    console.warn(
      `[ai] "${model}" gasto su presupuesto razonando; se reintenta con ${MAX_TOKENS_RAZONAMIENTO} tokens`
    );
    const holgado = { ...req, numPredict: MAX_TOKENS_RAZONAMIENTO };
    data2 = await conReintentos(() =>
      fetchJson(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'User-Agent': USER_AGENT,
          ...(motor?.sesion ? { 'x-opencode-session': motor.sesion } : {}),
        },
        body: JSON.stringify({
          ...JSON.parse(cuerpo(false)),
          max_tokens: holgado.numPredict,
        }),
      })
    );
  }

  const mensaje = data2?.choices?.[0]?.message;
  const text = mensaje?.content;
  if (typeof text !== 'string' || text.trim() === '') {
    // Los modelos de razonamiento gastan tokens pensando ANTES de escribir la
    // respuesta, y ese gasto sale del mismo max_tokens. Si el presupuesto se
    // agota razonando, la respuesta llega vacia sin que haya ningun error: el
    // proveedor cumplio. Decirlo asi ahorra buscar el problema en la clave o en
    // el endpoint, que es donde no esta.
    const razono =
      typeof mensaje?.reasoning_content === 'string' && mensaje.reasoning_content.trim() !== '';
    const corte = data?.choices?.[0]?.finish_reason;
    if (razono || corte === 'length') {
      throw new Error(
        `El modelo "${model}" contesto vacio: gasto razonando incluso los ${MAX_TOKENS_RAZONAMIENTO} ` +
          'tokens del reintento. Probá con un modelo sin razonamiento para esta tarea.'
      );
    }
    throw new Error(`El proveedor devolvio una respuesta vacia (modelo "${model}")`);
  }
  return { text, provider: 'openai', model };
}

// ---------------- Estrategia mixta ----------------

/**
 * Resuelve la peticion segun AI_STRATEGY:
 *  - local:  solo Ollama (cumple el requisito de IA local del enunciado)
 *  - cloud:  solo OpenAI
 *  - hybrid: Ollama primero y, si no esta corriendo o falla, OpenAI como respaldo
 *
 * El respaldo importa el dia de la defensa: si el modelo local no arranca, la
 * demostracion no se cae.
 */
export async function chat(req: ChatRequest, motor?: Motor): Promise<ChatResult> {
  const { strategy } = config.ai;

  // Con clave propia del usuario no hay estrategia que decidir: el Ollama del
  // servidor no es lo que pidio, asi que se va derecho a su proveedor.
  if (motor?.apiKey) return openaiChat(req, motor);

  if (strategy === 'cloud') return openaiChat(req);
  if (strategy === 'local') return ollamaChat(req);

  try {
    return await ollamaChat(req);
  } catch (localError) {
    console.warn(
      '[ai] IA local no disponible, usando la nube:',
      localError instanceof Error ? localError.message : localError
    );
    if (!config.ai.openaiApiKey) {
      // El motivo real va primero: casi siempre es un modelo sin descargar o un
      // nombre de modelo que no coincide con el de "ollama list", y el mensaje
      // generico anterior no permitia darse cuenta.
      const motivo = localError instanceof Error ? localError.message : String(localError);
      throw new Error(
        `${motivo}\n\n(No hay OPENAI_API_KEY configurada como respaldo en server/.env.)`
      );
    }
    return openaiChat(req);
  }
}

/** Estado de los proveedores, para mostrarlo en la interfaz. */
export async function aiStatus() {
  const instalados = await listOllamaModels();
  // Ollama acepta "qwen2.5:7b-instruct" y tambien lo lista como
  // "qwen2.5:7b-instruct" o con sufijo, asi que se compara por prefijo.
  // Ollama lista los modelos con su tag ("qwen2.5:7b-instruct"). Un nombre sin
  // tag en .env se resuelve contra "<nombre>:latest".
  const tiene = (m: string) =>
    instalados.some(i => i === m || i === `${m}:latest` || i.replace(/:latest$/, '') === m);
  return {
    strategy: config.ai.strategy,
    local: {
      available: instalados.length > 0 || (await isOllamaAvailable()),
      baseUrl: config.ai.ollamaBaseUrl,
      model: config.ai.ollamaModel,
      visionModel: config.ai.ollamaVisionModel,
      /** Lo que realmente hay descargado: es el diagnostico que faltaba. */
      instalados,
      modelInstalado: tiene(config.ai.ollamaModel),
      visionModelInstalado: tiene(config.ai.ollamaVisionModel),
    },
    cloud: {
      available: Boolean(config.ai.openaiApiKey),
      model: config.ai.openaiModel,
      visionModel: config.ai.openaiVisionModel,
    },
  };
}
