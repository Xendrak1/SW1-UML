/**
 * De donde sale la IA, decidido por cada usuario en su navegador.
 *
 * Antes lo decidia el servidor con una sola clave en su configuracion. Eso tiene
 * dos problemas en un despliegue en la nube: el consumo de todos va contra una
 * misma cuenta, y si a esa clave se le acaba el credito la IA deja de funcionar
 * para todo el mundo a la vez. Ademas, en la nube no hay Ollama, asi que la
 * "IA local" que promete el sistema no existiria.
 *
 * Aca se resuelven las dos cosas:
 *   - "local": el navegador le habla directo al Ollama de ESTA maquina. El
 *     servidor sigue decidiendo que se le pregunta y validando lo que contesta
 *     (ver el relevo en el backend); solo la llamada al modelo pasa por aca,
 *     porque un servidor en AWS no puede alcanzar un localhost ajeno.
 *   - "nube": la clave del usuario viaja en la cabecera de la peticion, se usa y
 *     se descarta. No se guarda en la base.
 *
 * La clave se guarda en localStorage, que es legible por cualquier script que
 * corra en esta pagina. Es una concesion consciente: la alternativa -guardarla
 * en el servidor- la expone a mas gente y la vuelve responsabilidad de otro. Se
 * avisa en la interfaz y se ofrece no recordarla.
 */

export type ModoIa = 'auto' | 'local' | 'nube' | 'sin-ia';

export interface AjustesIa {
  modo: ModoIa;
  /** Ollama de esta maquina. */
  ollamaUrl: string;
  ollamaModelo: string;
  ollamaModeloVision: string;
  /** Proveedor en la nube, con la clave del usuario. */
  claveNube: string;
  baseUrlNube: string;
  modeloNube: string;
  modeloNubeVision: string;
  /** Si es false, la clave vive solo en memoria y se pierde al cerrar. */
  recordarClave: boolean;
}

const CLAVE_ALMACEN = 'case.ajustes-ia';

/**
 * Identificador de sesion para el proveedor.
 *
 * Existe porque algunas pasarelas (OpenCode Go entre ellas) rechazan la peticion
 * si no pueden agrupar los mensajes de una misma conversacion. Se genera una vez
 * por pestana y se manda igual a todos: al que no lo usa no le molesta.
 */
let sesionIa = '';

export function sesionDeIa(): string {
  if (sesionIa === '') {
    sesionIa =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return sesionIa;
}

export const PROVEEDORES = [
  {
    // Gemini expone un endpoint compatible con OpenAI, asi que entra por el
    // mismo camino que los demas sin codigo especial. La clave va como Bearer.
    id: 'gemini',
    nombre: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelo: 'gemini-3.6-flash',
    modeloVision: 'gemini-3.6-flash',
  },
  {
    // El plan Go de OpenCode: endpoint propio, distinto del de Zen (que cobra
    // contra un saldo aparte). Pide ademas la cabecera de sesion.
    id: 'opencode-go',
    nombre: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
    modelo: 'glm-5.3-flash',
    modeloVision: 'deepseek-v4-flash-vision-exp',
  },
  {
    id: 'openai',
    nombre: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    modelo: 'gpt-4o-mini',
    modeloVision: 'gpt-4o-mini',
  },
  {
    id: 'openrouter',
    nombre: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    modelo: 'openai/gpt-4o-mini',
    modeloVision: 'openai/gpt-4o-mini',
  },
] as const;

export const AJUSTES_POR_DEFECTO: AjustesIa = {
  modo: 'auto',
  ollamaUrl: 'http://localhost:11434',
  ollamaModelo: 'qwen2.5:7b-instruct',
  ollamaModeloVision: 'llama3.2-vision:11b',
  claveNube: '',
  baseUrlNube: PROVEEDORES[0].baseUrl,
  modeloNube: PROVEEDORES[0].modelo,
  modeloNubeVision: PROVEEDORES[0].modeloVision,
  recordarClave: true,
};

/** La clave cuando el usuario pidio no recordarla: vive lo que vive la pestana. */
let claveEnMemoria = '';

export function leerAjustesIa(): AjustesIa {
  try {
    const crudo = localStorage.getItem(CLAVE_ALMACEN);
    if (!crudo) return { ...AJUSTES_POR_DEFECTO, claveNube: claveEnMemoria };
    const guardado = JSON.parse(crudo) as Partial<AjustesIa>;
    return {
      ...AJUSTES_POR_DEFECTO,
      ...guardado,
      // Si no se recuerda, lo guardado nunca tiene clave: se usa la de memoria.
      claveNube: guardado.recordarClave === false ? claveEnMemoria : (guardado.claveNube ?? ''),
    };
  } catch {
    // localStorage puede fallar (modo privado, permisos): los ajustes no son
    // criticos, se sigue con los de por defecto.
    return { ...AJUSTES_POR_DEFECTO, claveNube: claveEnMemoria };
  }
}

export function guardarAjustesIa(ajustes: AjustesIa): void {
  claveEnMemoria = ajustes.claveNube;
  try {
    const aGuardar: AjustesIa = ajustes.recordarClave
      ? ajustes
      : { ...ajustes, claveNube: '' };
    localStorage.setItem(CLAVE_ALMACEN, JSON.stringify(aGuardar));
  } catch {
    /* sin almacenamiento, los ajustes duran lo que dura la pestana */
  }
}

export function olvidarClaveIa(): void {
  claveEnMemoria = '';
  const a = leerAjustesIa();
  guardarAjustesIa({ ...a, claveNube: '' });
}

/** Cabeceras con la clave del usuario, para las llamadas que resuelve el servidor. */
export function cabecerasDeIa(ajustes: AjustesIa = leerAjustesIa()): Record<string, string> {
  if (ajustes.modo === 'local' || ajustes.modo === 'sin-ia') return {};
  if (ajustes.claveNube.trim() === '') return {};
  return {
    'x-ia-clave': ajustes.claveNube.trim(),
    'x-ia-base-url': ajustes.baseUrlNube,
    'x-ia-modelo': ajustes.modeloNube,
    'x-ia-modelo-vision': ajustes.modeloNubeVision,
    'x-ia-sesion': sesionDeIa(),
  };
}

export type Camino = 'local' | 'nube' | 'servidor' | 'sin-ia';

/**
 * El camino que pidio el usuario, sin probar nada.
 *
 * "auto" no se resuelve aca porque para decidirlo hay que preguntarle a Ollama
 * si esta levantado, y eso es asincronico: lo resuelve resolverCamino() en
 * iaRelevo.ts. Aca queda la parte que se puede contestar mirando los ajustes.
 */
export function caminoPedido(ajustes: AjustesIa = leerAjustesIa()): Camino | 'auto' {
  if (ajustes.modo === 'local') return 'local';
  if (ajustes.modo === 'sin-ia') return 'sin-ia';
  if (ajustes.modo === 'nube') return ajustes.claveNube.trim() !== '' ? 'nube' : 'servidor';
  return 'auto';
}
