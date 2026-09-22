import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import {
  flujoDeInstruccion,
  flujoImagen,
  flujoPregunta,
  type Flujo,
  type Peticion,
  type Resultado,
} from '../ai/flujos.js';
import {
  ModeloNoInstaladoError,
  aiStatus,
  chat,
  type ChatResult,
  type Motor,
} from '../ai/provider.js';
import { validarAcciones, validarDiagramaReconocido } from '../ai/validate.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

/**
 * La clave de IA del usuario, si la mando.
 *
 * Viaja por cabecera y no por el cuerpo para que no termine nunca en un log de
 * peticiones ni en el historial de una herramienta que registre los JSON. Se
 * usa para la llamada y se olvida: no se guarda en la base.
 */
function motorDeCabeceras(req: Request): Motor | undefined {
  const clave = String(req.header('x-ia-clave') ?? '').trim();
  if (clave === '') return undefined;
  const texto = (n: string): string | undefined => {
    const v = String(req.header(n) ?? '').trim();
    return v === '' ? undefined : v;
  };
  return {
    apiKey: clave,
    baseUrl: texto('x-ia-base-url'),
    modelo: texto('x-ia-modelo'),
    modeloVision: texto('x-ia-modelo-vision'),
  };
}

/**
 * Conduce un flujo llamando al proveedor del servidor (o al del usuario).
 *
 * Es uno de los dos conductores posibles; el otro es el navegador, que va paso
 * a paso por HTTP para poder hablarle al Ollama de su propia maquina.
 */
async function conducir(
  flujo: Flujo,
  motor?: Motor
): Promise<{ resultado: Resultado; provider: string; model: string }> {
  let paso = await flujo.next();
  let ultimo: ChatResult | undefined;
  while (!paso.done) {
    ultimo = await chat(paso.value, motor);
    paso = await flujo.next(ultimo.text);
  }
  return {
    resultado: paso.value,
    provider: ultimo?.provider ?? 'desconocido',
    model: ultimo?.model ?? 'desconocido',
  };
}

// ----------------------------------------------- respuestas, una por tipo

function respuestaAcciones(r: Resultado, provider: string, model: string) {
  const { actions, descartadas } = validarAcciones(r.parsed);
  if (descartadas.length > 0) {
    console.warn(
      `[ai] ${descartadas.length} accion(es) descartada(s):`,
      descartadas.map(d => d.motivo).join(' | ')
    );
  }
  console.log(
    `[ai] ${actions.length} accion(es) validas via ${provider} (${model}) [modo ${r.modo}]` +
      (r.etapas.length > 0 ? ` ${r.etapas.join(' ')}` : '') +
      (r.reparado ? ' [respuesta reparada]' : '') +
      (r.rescatado ? ' [respuesta truncada, rescatada]' : '')
  );
  return {
    actions,
    provider,
    model,
    modo: r.modo,
    etapas: r.etapas,
    reparado: r.reparado,
    rescatado: r.rescatado,
    descartadas: descartadas.map(d => d.motivo),
  };
}

function respuestaImagen(r: Resultado, provider: string, model: string) {
  const { classes, relations, descartadas } = validarDiagramaReconocido(r.parsed);
  if (descartadas.length > 0) {
    console.warn(
      `[ai] imagen: ${descartadas.length} elemento(s) descartado(s):`,
      descartadas.map(d => d.motivo).join(' | ')
    );
  }
  console.log(
    `[ai] imagen: ${classes.length} clases y ${relations.length} relaciones via ` +
      `${provider} (${model})` + (r.reparado ? ' [reparada]' : '')
  );
  return {
    classes,
    relations,
    provider,
    model,
    reparado: r.reparado,
    descartadas: descartadas.map(d => d.motivo),
  };
}

function respuestaPregunta(r: Resultado, provider: string, model: string) {
  const answer = (r.parsed as { answer?: unknown })?.answer;
  return {
    answer:
      typeof answer === 'string' && answer.trim() !== ''
        ? answer
        : 'No encontre eso en la documentacion de la herramienta.',
    provider,
    model,
  };
}

type TipoFlujo = 'acciones' | 'imagen' | 'pregunta';

function formatear(tipo: TipoFlujo, r: Resultado, provider: string, model: string) {
  if (tipo === 'acciones') return respuestaAcciones(r, provider, model);
  if (tipo === 'imagen') return respuestaImagen(r, provider, model);
  return respuestaPregunta(r, provider, model);
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
  if (/No hay clave de IA|proveedor de IA/.test(msg)) {
    res.status(503).json({ error: msg });
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
    const { resultado, provider, model } = await conducir(
      flujoDeInstruccion(prompt, classes, relations),
      motorDeCabeceras(req)
    );
    res.json(respuestaAcciones(resultado, provider, model));
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
    const { resultado, provider, model } = await conducir(
      flujoPregunta(question, context),
      motorDeCabeceras(req)
    );
    res.json(respuestaPregunta(resultado, provider, model));
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
    const { resultado, provider, model } = await conducir(
      flujoImagen(req.file.buffer.toString('base64')),
      motorDeCabeceras(req)
    );
    res.json(respuestaImagen(resultado, provider, model));
  } catch (err) {
    if (!responderErrorDeIa(err, res)) next(err);
  }
});

// ------------------------------------------------------------------ relevo
//
// El navegador conduce el flujo cuando el modelo corre en la maquina DEL
// USUARIO: el servidor en la nube no puede llegar a un Ollama en localhost, pero
// el navegador que tiene la pagina abierta si. El servidor sigue decidiendo que
// se le pregunta al modelo y sigue validando lo que contesta; el navegador solo
// lleva y trae el texto.

interface Sesion {
  tipo: TipoFlujo;
  flujo: Flujo;
  usuario: string;
  creada: number;
  /** Cuantas veces se llamo al modelo. Un flujo sano usa entre 1 y 4. */
  pasos: number;
}

const SESIONES = new Map<string, Sesion>();
const VIDA_MS = 10 * 60 * 1000;
const MAX_PASOS = 8;
const MAX_SESIONES = 50;

function limpiarSesiones(): void {
  const limite = Date.now() - VIDA_MS;
  for (const [id, s] of SESIONES) {
    if (s.creada < limite) SESIONES.delete(id);
  }
}

/** Datos que el navegador necesita para hablarle a su propio modelo. */
function aPeticionPublica(p: Peticion) {
  return {
    system: p.system,
    user: p.user,
    imageBase64: p.imageBase64,
    numCtx: p.numCtx,
    numPredict: p.numPredict,
    temperature: p.temperature,
  };
}

async function avanzar(
  id: string,
  sesion: Sesion,
  texto: string | undefined,
  res: Response
): Promise<void> {
  const paso = texto === undefined ? await sesion.flujo.next() : await sesion.flujo.next(texto);
  if (paso.done) {
    SESIONES.delete(id);
    res.json({ listo: true, ...formatear(sesion.tipo, paso.value, 'ollama-navegador', 'local') });
    return;
  }
  sesion.pasos += 1;
  if (sesion.pasos > MAX_PASOS) {
    SESIONES.delete(id);
    res.status(500).json({ error: 'El flujo de IA pidio demasiados pasos y se corto' });
    return;
  }
  res.json({ sesion: id, peticion: aPeticionPublica(paso.value) });
}

function iniciarSesion(tipo: TipoFlujo, flujo: Flujo, req: Request, res: Response): Promise<void> {
  limpiarSesiones();
  if (SESIONES.size >= MAX_SESIONES) {
    res.status(503).json({ error: 'Hay demasiadas conversaciones de IA abiertas, intenta de nuevo' });
    return Promise.resolve();
  }
  const id = randomUUID();
  const sesion: Sesion = {
    tipo,
    flujo,
    usuario: req.sesion?.sub ?? 'anonimo',
    creada: Date.now(),
    pasos: 0,
  };
  SESIONES.set(id, sesion);
  return avanzar(id, sesion, undefined, res);
}

/** Arranca un flujo conducido por el navegador. Devuelve la primera peticion. */
aiRouter.post('/relevo/iniciar', async (req, res, next) => {
  try {
    const { tipo, prompt, classes = [], relations = [], question, context } = req.body ?? {};
    if (tipo === 'acciones') {
      if (typeof prompt !== 'string' || prompt.trim() === '' || prompt.length > 2000) {
        res.status(400).json({ error: 'Instruccion invalida' });
        return;
      }
      await iniciarSesion('acciones', flujoDeInstruccion(prompt, classes, relations), req, res);
      return;
    }
    if (tipo === 'pregunta') {
      if (typeof question !== 'string' || question.trim() === '') {
        res.status(400).json({ error: 'Falta el campo "question"' });
        return;
      }
      await iniciarSesion('pregunta', flujoPregunta(question, context), req, res);
      return;
    }
    res.status(400).json({ error: 'Tipo de flujo desconocido' });
  } catch (err) {
    if (!responderErrorDeIa(err, res)) next(err);
  }
});

/** Igual que el anterior pero para una imagen, que va como multipart. */
aiRouter.post('/relevo/iniciar-imagen', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Falta el archivo "image"' });
      return;
    }
    await iniciarSesion('imagen', flujoImagen(req.file.buffer.toString('base64')), req, res);
  } catch (err) {
    if (!responderErrorDeIa(err, res)) next(err);
  }
});

/** El navegador devuelve lo que contesto su modelo y pide el siguiente paso. */
aiRouter.post('/relevo/paso', async (req, res, next) => {
  try {
    const { sesion: id, texto } = req.body ?? {};
    if (typeof id !== 'string' || typeof texto !== 'string') {
      res.status(400).json({ error: 'Faltan "sesion" o "texto"' });
      return;
    }
    limpiarSesiones();
    const sesion = SESIONES.get(id);
    if (!sesion) {
      res.status(404).json({ error: 'La conversacion de IA expiro, volve a intentar' });
      return;
    }
    // Una sesion es de quien la abrio: el id es aleatorio, pero comprobarlo
    // cuesta una linea y evita que un id filtrado sirva para otra cuenta.
    if (sesion.usuario !== (req.sesion?.sub ?? 'anonimo')) {
      res.status(403).json({ error: 'Esa conversacion de IA no es tuya' });
      return;
    }
    await avanzar(id, sesion, texto, res);
  } catch (err) {
    if (!responderErrorDeIa(err, res)) next(err);
  }
});
