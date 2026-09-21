import { Router, type Response } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import {
  IMAGE_TO_UML_SYSTEM,
  IMAGE_TO_UML_USER,
  REPAIR_SYSTEM,
  UML_ACTIONS_SYSTEM,
  umlActionsUser,
} from '../ai/prompts.js';
import {
  MAX_CLASES_DOMINIO,
  UML_DOMAIN_CLASSES_SYSTEM,
  UML_DOMAIN_RELATIONS_SYSTEM,
  esPeticionDeDominio,
  minimoSolicitado,
  umlDomainClassesUser,
  umlDomainFaltantesUser,
  umlDomainRelationsUser,
} from '../ai/promptsDominio.js';
import {
  ModeloNoInstaladoError,
  aiStatus,
  chat,
  type ChatResult,
} from '../ai/provider.js';
import {
  parseJsonLoose,
  rescatarAccionesParciales,
  rescatarClasesParciales,
  rescatarRelacionesParciales,
  validarAcciones,
  validarDiagramaReconocido,
} from '../ai/validate.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/**
 * Pide al modelo, y si la respuesta no es JSON valido lo intenta reparar una vez
 * pasandole su propia salida. Un modelo local de 7B falla el formato cada tanto;
 * un reintento de reparacion recupera la mayoria de esos casos y sale mucho mas
 * barato que hacer que el usuario repita la instruccion.
 */
/** Como rescatar una respuesta truncada segun lo que se pidio. */
type Rescate = { clave: 'actions' | 'classes' | 'relations'; extraer: (t: string) => unknown[] };

const RESCATE_ACCIONES: Rescate = { clave: 'actions', extraer: rescatarAccionesParciales };
const RESCATE_CLASES: Rescate = { clave: 'classes', extraer: rescatarClasesParciales };
const RESCATE_RELACIONES: Rescate = { clave: 'relations', extraer: rescatarRelacionesParciales };

async function pedirJson(
  system: string,
  user: string,
  imageBase64?: string,
  numCtx?: number,
  rescate: Rescate = RESCATE_ACCIONES
): Promise<{ parsed: unknown; result: ChatResult; reparado: boolean; rescatado: boolean }> {
  const result = await chat({ system, user, imageBase64, numCtx });
  try {
    return { parsed: parseJsonLoose(result.text), result, reparado: false, rescatado: false };
  } catch (primerError) {
    console.warn(
      '[ai] respuesta mal formada:',
      primerError instanceof Error ? primerError.message : primerError
    );

    // Antes de gastar otra llamada: si la respuesta se corto a mitad del JSON
    // (lo tipico al pedir un dominio completo), las acciones ya cerradas sirven.
    const rescatadas = rescate.extraer(result.text);
    if (rescatadas.length > 0) {
      console.warn(
        `[ai] respuesta truncada, rescatado(s) ${rescatadas.length} elemento(s) completos (${rescate.clave})`
      );
      return {
        parsed: { [rescate.clave]: rescatadas },
        result,
        reparado: false,
        rescatado: true,
      };
    }

    const reparacion = await chat({
      system: REPAIR_SYSTEM,
      user: `Texto a corregir:\n\n${result.text.slice(0, 4000)}`,
    });
    // Si la reparacion tambien falla, propaga el error con la respuesta original,
    // que es la que le sirve al usuario para entender que paso.
    return { parsed: parseJsonLoose(reparacion.text), result, reparado: true, rescatado: false };
  }
}

/**
 * Modo dominio en dos etapas.
 *
 * Un 7B no sostiene un JSON de treinta y cinco acciones: se pierde, repite
 * clases, inventa relaciones con clases que nunca creo, o se corta. Partirlo
 * en dos llamadas cortas lo cambia todo, y la segunda recibe la lista REAL de
 * clases de la primera en vez de lo que el modelo crea recordar.
 *
 * Si la etapa 1 devuelve menos clases que el minimo pedido, se pide una vez mas
 * solo lo que falta. Si la etapa 2 falla, se devuelven igual las clases: un
 * modelo sin relaciones se arregla a mano en un minuto, perder el modelo entero
 * no.
 */
async function modelarDominio(
  prompt: string,
  classes: unknown
): Promise<{
  parsed: unknown;
  result: ChatResult;
  reparado: boolean;
  rescatado: boolean;
  etapas: string[];
}> {
  const existentes = Array.isArray(classes)
    ? (classes as Array<{ nombre?: string; label?: string }>)
        .map(c => c?.nombre ?? c?.label)
        .filter((x): x is string => Boolean(x))
    : [];
  const minimo = minimoSolicitado(prompt);
  const etapas: string[] = [];

  // ---- Etapa 1: clases con sus atributos ----
  const e1 = await pedirJson(
    UML_DOMAIN_CLASSES_SYSTEM.replace(
      'CANTIDAD_DE_CLASES',
      `Al menos ${minimo} y como maximo ${MAX_CLASES_DOMINIO}`
    ),
    umlDomainClassesUser(prompt, existentes, minimo),
    undefined,
    12288,
    RESCATE_CLASES
  );

  const leerClases = (raw: unknown): Array<Record<string, unknown>> => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const lista = Array.isArray(r.classes) ? r.classes : Array.isArray(raw) ? raw : [];
    return (lista as unknown[]).filter(
      (c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object'
    );
  };

  let clases = leerClases(e1.parsed);
  etapas.push(`clases=${clases.length}`);

  // ---- Etapa 1b: completar si quedo corto ----
  if (clases.length > 0 && clases.length < minimo) {
    const nombres = clases.map(c => String(c.label ?? c.name ?? '')).filter(Boolean);
    try {
      const e1b = await pedirJson(
        UML_DOMAIN_CLASSES_SYSTEM.replace(
          'CANTIDAD_DE_CLASES',
          `Exactamente ${minimo - clases.length}`
        ),
        umlDomainFaltantesUser(prompt, nombres, minimo - clases.length),
        undefined,
        12288,
        RESCATE_CLASES
      );
      const extra = leerClases(e1b.parsed).filter(c => {
        const l = String(c.label ?? c.name ?? '').toLowerCase();
        return l !== '' && !nombres.some(n => n.toLowerCase() === l);
      });
      if (extra.length > 0) {
        clases = clases.concat(extra);
        etapas.push(`completadas=+${extra.length}`);
      }
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

  let rescatado = e1.rescatado;
  let reparado = e1.reparado;

  if (resumen.length >= 2) {
    try {
      const e2 = await pedirJson(
        UML_DOMAIN_RELATIONS_SYSTEM,
        umlDomainRelationsUser(prompt, resumen),
        undefined,
        12288,
        RESCATE_RELACIONES
      );
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

  return { parsed: { actions: acciones }, result: e1.result, reparado, rescatado, etapas };
}

/**
 * Un modelo sin descargar no es un error del servidor: es algo que el usuario
 * puede resolver en una linea. Se devuelve 503 con el comando exacto en vez de
 * un 500 con "la IA local fallo", que era lo que se veia en la alerta del
 * navegador y no permitia darse cuenta de nada.
 */
function responderErrorDeIa(err: unknown, res: Response): boolean {
  const causa = err instanceof ModeloNoInstaladoError ? err : undefined;
  const msg = err instanceof Error ? err.message : String(err);
  if (causa || /no esta descargado en Ollama/.test(msg)) {
    res.status(503).json({
      error: msg,
      modelo: causa?.modelo,
      remedio: causa ? `ollama pull ${causa.modelo}` : undefined,
    });
    return true;
  }
  if (/fetch failed|ECONNREFUSED/i.test(msg)) {
    res.status(503).json({
      error:
        'No se pudo contactar a Ollama en ' +
        `${config.ai.ollamaBaseUrl}. ` +
        'Levantalo con "ollama serve" y volve a intentar.',
    });
    return true;
  }
  return false;
}

export const aiRouter = Router();

aiRouter.get('/status', async (_req, res, next) => {
  try {
    res.json(await aiStatus());
  } catch (err) {
    next(err);
  }
});

/** Instruccion en lenguaje natural (texto o voz) -> acciones sobre el diagrama. */
aiRouter.post('/uml-actions', async (req, res, next) => {
  try {
    const { prompt, classes = [], relations = [] } = req.body ?? {};
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      res.status(400).json({ error: 'Falta el campo "prompt"' });
      return;
    }
    if (prompt.length > 2000) {
      res.status(400).json({ error: 'La instruccion es demasiado larga' });
      return;
    }

    // Dos modos. El atomico traduce una instruccion puntual; el de dominio
    // construye el modelo completo de un negocio en dos etapas.
    const modoDominio = esPeticionDeDominio(prompt);

    let parsed: unknown;
    let result: ChatResult;
    let reparado = false;
    let rescatado = false;
    let etapas: string[] = [];

    if (modoDominio) {
      const dom = await modelarDominio(prompt, classes);
      parsed = dom.parsed;
      result = dom.result;
      reparado = dom.reparado;
      rescatado = dom.rescatado;
      etapas = dom.etapas;
    } else {
      const uno = await pedirJson(UML_ACTIONS_SYSTEM, umlActionsUser(prompt, classes, relations));
      parsed = uno.parsed;
      result = uno.result;
      reparado = uno.reparado;
      rescatado = uno.rescatado;
    }

    const { actions, descartadas } = validarAcciones(parsed);

    if (descartadas.length > 0) {
      console.warn(`[ai] ${descartadas.length} accion(es) descartada(s):`,
        descartadas.map(d => d.motivo).join(' | '));
    }
    console.log(
      `[ai] ${actions.length} accion(es) validas via ${result.provider} (${result.model}) ` +
        `[modo ${modoDominio ? 'dominio' : 'atomico'}]` +
        (etapas.length > 0 ? ` ${etapas.join(' ')}` : '') +
        (reparado ? ' [respuesta reparada]' : '') +
        (rescatado ? ' [respuesta truncada, rescatada]' : '')
    );

    res.json({
      actions,
      provider: result.provider,
      model: result.model,
      modo: modoDominio ? 'dominio' : 'atomico',
      etapas,
      reparado,
      rescatado,
      descartadas: descartadas.map(d => d.motivo),
    });
  } catch (err) {
    if (!responderErrorDeIa(err, res)) next(err);
  }
});

/** Pregunta libre con contexto acotado. La usa la guia de usuario. */
aiRouter.post('/ask', async (req, res, next) => {
  try {
    const { question, context } = req.body ?? {};
    if (typeof question !== 'string' || question.trim() === '') {
      res.status(400).json({ error: 'Falta el campo "question"' });
      return;
    }

    const { parsed, result } = await pedirJson(
      'Sos la guia de usuario de una herramienta CASE de modelado UML. Respondes usando ' +
        'UNICAMENTE la documentacion que se te entrega. Si la documentacion no cubre la ' +
        'pregunta, lo decis claramente en vez de inventar funciones que no existen. ' +
        'Respondes en espanol, en un parrafo corto y concreto. ' +
        'Devolves UNICAMENTE un objeto JSON con la forma {"answer": "..."}.',
      `DOCUMENTACION:\n${String(context ?? '').slice(0, 20000)}\n\nPREGUNTA: ${question}`
    );

    const answer = (parsed as { answer?: unknown })?.answer;
    res.json({
      answer:
        typeof answer === 'string' && answer.trim() !== ''
          ? answer
          : 'No encontre eso en la documentacion de la herramienta.',
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    if (!responderErrorDeIa(err, res)) next(err);
  }
});

/** Foto de un diagrama -> clases y relaciones. */
aiRouter.post('/image-to-uml', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Falta el archivo "image"' });
      return;
    }

    const { parsed, result, reparado } = await pedirJson(
      IMAGE_TO_UML_SYSTEM,
      IMAGE_TO_UML_USER,
      req.file.buffer.toString('base64')
    );

    const { classes, relations, descartadas } = validarDiagramaReconocido(parsed);

    if (descartadas.length > 0) {
      console.warn(`[ai] imagen: ${descartadas.length} elemento(s) descartado(s):`,
        descartadas.map(d => d.motivo).join(' | '));
    }
    console.log(
      `[ai] imagen: ${classes.length} clases y ${relations.length} relaciones via ` +
        `${result.provider} (${result.model})` + (reparado ? ' [reparada]' : '')
    );

    res.json({
      classes,
      relations,
      provider: result.provider,
      model: result.model,
      reparado,
      descartadas: descartadas.map(d => d.motivo),
    });
  } catch (err) {
    if (!responderErrorDeIa(err, res)) next(err);
  }
});
