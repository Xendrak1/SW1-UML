/**
 * La conversacion con el modelo, escrita como generadores.
 *
 * El problema que resuelve: el modelo puede vivir en tres lados distintos (el
 * Ollama del servidor, un proveedor en la nube, o el Ollama que corre en la
 * maquina del usuario, al que solo llega su propio navegador) y la logica de
 * como se le habla es la misma en los tres casos: el mismo prompt, la misma
 * reparacion cuando devuelve JSON roto, las mismas dos etapas para modelar un
 * dominio.
 *
 * Si esa logica se copiara al cliente para el caso del Ollama del usuario,
 * habria dos implementaciones que se desincronizan a la primera correccion. Con
 * generadores hay una sola: el flujo PIDE prompts y RECIBE texto, y quien lo
 * conduce decide a quien le pregunta. El servidor lo conduce llamando al
 * proveedor; el navegador lo conduce de a un paso por HTTP.
 */
import {
  IMAGE_TO_UML_SYSTEM,
  IMAGE_TO_UML_USER,
  REPAIR_SYSTEM,
  UML_ACTIONS_SYSTEM,
  umlActionsUser,
} from './prompts.js';
import {
  MAX_CLASES_DOMINIO,
  UML_DOMAIN_CLASSES_SYSTEM,
  UML_DOMAIN_RELATIONS_SYSTEM,
  esPeticionDeDominio,
  minimoSolicitado,
  umlDomainClassesUser,
  umlDomainFaltantesUser,
  umlDomainRelationsUser,
} from './promptsDominio.js';
import {
  parseJsonLoose,
  rescatarAccionesParciales,
  rescatarClasesParciales,
  rescatarRelacionesParciales,
} from './validate.js';

/** Como rescatar una respuesta que se corto a la mitad. */
export type ClaveRescate = 'actions' | 'classes' | 'relations' | 'ninguno';

const RESCATADORES: Record<ClaveRescate, (t: string) => unknown[]> = {
  actions: rescatarAccionesParciales,
  classes: rescatarClasesParciales,
  relations: rescatarRelacionesParciales,
  ninguno: () => [],
};

/** Una pregunta al modelo. Es lo que el flujo entrega a quien lo conduce. */
export interface Peticion {
  system: string;
  user: string;
  imageBase64?: string;
  numCtx?: number;
  numPredict?: number;
  temperature?: number;
  rescate: ClaveRescate;
}

export interface Resultado {
  parsed: unknown;
  reparado: boolean;
  rescatado: boolean;
  /** Traza de las etapas, para el log y para la interfaz. */
  etapas: string[];
  /** "dominio" o "atomico" en el caso de las acciones. */
  modo?: string;
}

/** Un flujo pide Peticiones, recibe el texto del modelo y termina en Resultado. */
export type Flujo = AsyncGenerator<Peticion, Resultado, string>;

interface Analisis {
  parsed: unknown;
  reparado: boolean;
  rescatado: boolean;
}

/**
 * Pide una respuesta en JSON y la interpreta.
 *
 * Orden deliberado: primero se intenta parsear; si falla, se mira si la
 * respuesta se corto a mitad de camino y las partes ya cerradas sirven (pasa
 * seguido al pedir un dominio entero); recien si no hay nada rescatable se
 * gasta una segunda llamada pidiendole al modelo que repare su propia salida.
 * Reparar es lo mas caro, por eso va ultimo.
 */
async function* pedirJson(p: Peticion): AsyncGenerator<Peticion, Analisis, string> {
  const texto = yield p;
  try {
    return { parsed: parseJsonLoose(texto), reparado: false, rescatado: false };
  } catch (primerError) {
    console.warn(
      '[ai] respuesta mal formada:',
      primerError instanceof Error ? primerError.message : primerError
    );

    const rescatadas = RESCATADORES[p.rescate](texto);
    if (rescatadas.length > 0) {
      console.warn(
        `[ai] respuesta truncada, rescatado(s) ${rescatadas.length} elemento(s) (${p.rescate})`
      );
      return { parsed: { [p.rescate]: rescatadas }, reparado: false, rescatado: true };
    }

    const reparado = yield {
      system: REPAIR_SYSTEM,
      user: texto,
      rescate: p.rescate,
      numCtx: p.numCtx,
    };
    return { parsed: parseJsonLoose(reparado), reparado: true, rescatado: false };
  }
}

// --------------------------------------------------------------- instrucciones

/** Instruccion puntual: una sola pregunta al modelo. */
async function* flujoAtomico(
  prompt: string,
  classes: unknown,
  relations: unknown
): Flujo {
  const a = yield* pedirJson({
    system: UML_ACTIONS_SYSTEM,
    user: umlActionsUser(prompt, classes, relations),
    rescate: 'actions',
  });
  return { ...a, etapas: [], modo: 'atomico' };
}

const leerClases = (raw: unknown): Array<Record<string, unknown>> => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lista = Array.isArray(r.classes) ? r.classes : Array.isArray(raw) ? raw : [];
  return (lista as unknown[]).filter(
    (c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object'
  );
};

/**
 * Modelo de dominio completo, en dos etapas.
 *
 * Una sola pregunta para "modelame Starbucks" devuelve una clase y se queda
 * corto: el modelo se queda sin contexto tratando de resolver clases y
 * relaciones a la vez. Separado, la etapa 1 solo piensa en clases y la etapa 2
 * relaciona una lista ya cerrada, que es un problema mucho mas chico.
 */
async function* flujoDominio(prompt: string, classes: unknown): Flujo {
  const existentes = Array.isArray(classes)
    ? (classes as Array<{ nombre?: string; label?: string }>)
        .map(c => c?.nombre ?? c?.label)
        .filter((x): x is string => Boolean(x))
    : [];
  const minimo = minimoSolicitado(prompt);
  const etapas: string[] = [];

  // ---- Etapa 1: clases con sus atributos ----
  const e1 = yield* pedirJson({
    system: UML_DOMAIN_CLASSES_SYSTEM.replace(
      'CANTIDAD_DE_CLASES',
      `Al menos ${minimo} y como maximo ${MAX_CLASES_DOMINIO}`
    ),
    user: umlDomainClassesUser(prompt, existentes, minimo),
    numCtx: 12288,
    rescate: 'classes',
  });

  let clases = leerClases(e1.parsed);
  etapas.push(`clases=${clases.length}`);
  let reparado = e1.reparado;
  let rescatado = e1.rescatado;

  // ---- Etapa 1b: completar si quedo corto ----
  if (clases.length > 0 && clases.length < minimo) {
    const nombres = clases.map(c => String(c.label ?? c.name ?? '')).filter(Boolean);
    try {
      const e1b = yield* pedirJson({
        system: UML_DOMAIN_CLASSES_SYSTEM.replace(
          'CANTIDAD_DE_CLASES',
          `Exactamente ${minimo - clases.length}`
        ),
        user: umlDomainFaltantesUser(prompt, nombres, minimo - clases.length),
        numCtx: 12288,
        rescate: 'classes',
      });
      const extra = leerClases(e1b.parsed).filter(c => {
        const l = String(c.label ?? c.name ?? '').toLowerCase();
        return l !== '' && !nombres.some(n => n.toLowerCase() === l);
      });
      if (extra.length > 0) {
        clases = clases.concat(extra);
        etapas.push(`completadas=+${extra.length}`);
      }
      reparado = reparado || e1b.reparado;
      rescatado = rescatado || e1b.rescatado;
    } catch (err) {
      // Quedarse con las clases de la primera pasada es mejor que fallar.
      console.warn(
        '[ai] no se pudo completar las clases faltantes:',
        err instanceof Error ? err.message : err
      );
    }
  }

  if (clases.length > MAX_CLASES_DOMINIO) clases = clases.slice(0, MAX_CLASES_DOMINIO);
  const acciones: unknown[] = clases.map(c => ({ type: 'create', target: 'class', data: c }));

  // ---- Etapa 2: relaciones sobre la lista ya cerrada ----
  const resumen = clases.map(c => ({
    label: String(c.label ?? c.name ?? ''),
    asociativa: c.asociativa === true,
    relaciona: Array.isArray(c.relaciona) ? (c.relaciona as unknown[]).map(String) : undefined,
  }));

  if (resumen.length >= 2) {
    try {
      const e2 = yield* pedirJson({
        system: UML_DOMAIN_RELATIONS_SYSTEM,
        user: umlDomainRelationsUser(prompt, resumen),
        numCtx: 12288,
        rescate: 'relations',
      });
      const r2 = (e2.parsed ?? {}) as Record<string, unknown>;
      const rels = Array.isArray(r2.relations)
        ? r2.relations
        : Array.isArray(r2.actions)
          ? (r2.actions as Array<Record<string, unknown>>).map(a => a.data ?? a)
          : [];
      // Toda relacion que nombre una clase fuera de la lista se tira aca mismo:
      // es el descarte que antes hacia el validador sin saber por que.
      const validos = new Set(resumen.map(c => c.label.toLowerCase()));
      let fuera = 0;
      for (const rel of rels as Array<Record<string, unknown>>) {
        const a = String(rel?.sourceLabel ?? rel?.source ?? rel?.from ?? '').toLowerCase();
        const b = String(rel?.targetLabel ?? rel?.target ?? rel?.to ?? '').toLowerCase();
        if (!validos.has(a) || !validos.has(b)) {
          fuera += 1;
          continue;
        }
        acciones.push({ type: 'create', target: 'edge', data: rel });
      }
      const cuantas = acciones.length - clases.length;
      etapas.push(`relaciones=${cuantas}`);
      if (cuantas === 0) {
        console.warn(
          '[ai] la etapa de relaciones no devolvio ninguna relacion valida: ' +
            'el modelo quedo con las clases sueltas y hay que relacionarlas a mano.'
        );
      }
      if (fuera > 0) etapas.push(`relaciones_fuera_de_lista=${fuera}`);
      reparado = reparado || e2.reparado;
      rescatado = rescatado || e2.rescatado;
    } catch (err) {
      console.warn(
        '[ai] la etapa de relaciones fallo, se devuelven solo las clases:',
        err instanceof Error ? err.message : err
      );
      etapas.push('relaciones=fallo');
    }
  }

  return { parsed: { actions: acciones }, reparado, rescatado, etapas, modo: 'dominio' };
}

/** Elige el flujo segun lo que pidio el usuario. */
export function flujoDeInstruccion(prompt: string, classes: unknown, relations: unknown): Flujo {
  return esPeticionDeDominio(prompt)
    ? flujoDominio(prompt, classes)
    : flujoAtomico(prompt, classes, relations);
}

// -------------------------------------------------------------------- imagen

export async function* flujoImagen(imageBase64: string): Flujo {
  const a = yield* pedirJson({
    system: IMAGE_TO_UML_SYSTEM,
    user: IMAGE_TO_UML_USER,
    imageBase64,
    rescate: 'ninguno',
  });
  return { ...a, etapas: [] };
}

// ------------------------------------------------------------------ pregunta

const GUIA_SYSTEM =
  'Sos la guia de usuario de una herramienta CASE de modelado UML. Respondes usando ' +
  'UNICAMENTE la documentacion que se te entrega. Si la documentacion no cubre la ' +
  'pregunta, lo decis claramente en vez de inventar funciones que no existen. ' +
  'Respondes en espanol, en un parrafo corto y concreto. ' +
  'Devolves UNICAMENTE un objeto JSON con la forma {"answer": "..."}.';

export async function* flujoPregunta(question: string, context: unknown): Flujo {
  const a = yield* pedirJson({
    system: GUIA_SYSTEM,
    user: `DOCUMENTACION:\n${String(context ?? '').slice(0, 20000)}\n\nPREGUNTA: ${question}`,
    rescate: 'ninguno',
  });
  return { ...a, etapas: [] };
}
