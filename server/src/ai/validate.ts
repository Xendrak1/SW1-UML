/**
 * Validacion y normalizacion de lo que devuelve la IA.
 *
 * Un modelo local de 7B acierta la estructura la mayoria de las veces, pero no
 * siempre: inventa un tipo de dato, escribe la multiplicidad como "0..*", omite
 * un campo o envuelve el JSON en markdown. Este modulo es la frontera: lo que
 * sale de aca ya esta dentro del dominio valido, o fue descartado con su motivo.
 *
 * Validar en el servidor y no en el cliente tiene una razon: el escritorio y la
 * PWA de voz consumen el mismo endpoint, y no queremos duplicar la validacion
 * ni arriesgar que una de las dos se quede atras.
 */

export const DATATYPES = ['String', 'Integer', 'Float', 'Boolean', 'Date'] as const;
export const SCOPES = ['public', 'private', 'protected'] as const;
export const TIPOS = ['asociacion', 'agregacion', 'composicion', 'herencia', 'dependencia'] as const;

type Datatype = (typeof DATATYPES)[number];
type Scope = (typeof SCOPES)[number];
type Tipo = (typeof TIPOS)[number];

/** Rescata el JSON aunque venga envuelto en markdown o con texto alrededor. */
export function parseJsonLoose(text: string): unknown {
  let t = text.trim();

  // Bloques de codigo: ```json ... ``` o ``` ... ```
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();

  try {
    return JSON.parse(t);
  } catch {
    /* seguimos intentando */
  }

  // Recorte por el primer delimitador de apertura y el ultimo de cierre.
  const start = t.search(/[[{]/);
  if (start >= 0) {
    const abre = t[start];
    const cierra = abre === '{' ? '}' : ']';
    const end = t.lastIndexOf(cierra);
    if (end > start) {
      const recorte = t.slice(start, end + 1);
      try {
        return JSON.parse(recorte);
      } catch {
        /* sigue mal formado */
      }
    }
  }

  throw new Error(`La IA no devolvio JSON valido. Respuesta: ${text.slice(0, 300)}`);
}

const normDatatype = (v: unknown): Datatype => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['int', 'integer', 'long', 'entero', 'number', 'numero'].includes(s)) return 'Integer';
  if (['float', 'double', 'decimal', 'real', 'numeric'].includes(s)) return 'Float';
  if (['bool', 'boolean', 'booleano'].includes(s)) return 'Boolean';
  if (['date', 'datetime', 'timestamp', 'fecha'].includes(s)) return 'Date';
  if (['string', 'text', 'texto', 'varchar', 'char', 'cadena'].includes(s)) return 'String';
  const exacto = DATATYPES.find(d => d.toLowerCase() === s);
  return exacto ?? 'String';
};

const normScope = (v: unknown): Scope => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '+' || s === 'public' || s === 'publico') return 'public';
  if (s === '#' || s === 'protected' || s === 'protegido') return 'protected';
  return 'private';
};

const normTipo = (v: unknown): Tipo => {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const exacto = TIPOS.find(t => t === s);
  if (exacto) return exacto;

  // Nombre del tipo, en espanol o en ingles.
  if (s.includes('heren') || s.includes('inherit') || s.includes('extend') || s.includes('general'))
    return 'herencia';
  if (s.includes('compos')) return 'composicion';
  if (s.includes('agreg') || s.includes('aggreg')) return 'agregacion';
  if (s.includes('depend')) return 'dependencia';
  if (s.includes('asocia') || s.includes('associat')) return 'asociacion';

  // Un modelo de vision a veces describe el simbolo dibujado en lugar de nombrar
  // el tipo de relacion. Se traduce la descripcion segun la notacion UML.
  const rombo = s.includes('rombo') || s.includes('diamond') || s.includes('romboide');
  const lleno = s.includes('lleno') || s.includes('relleno') || s.includes('fill') || s.includes('solid') || s.includes('negro') || s.includes('black');
  const hueco = s.includes('hueco') || s.includes('vacio') || s.includes('hollow') || s.includes('empty') || s.includes('open') || s.includes('blanco') || s.includes('white');
  if (rombo && lleno) return 'composicion';
  if (rombo && hueco) return 'agregacion';
  if (rombo) return 'agregacion'; // rombo sin precisar: el hueco es el caso mas comun
  if (s.includes('triangul') || s.includes('triangle') || s.includes('flecha hueca'))
    return 'herencia';
  if (s.includes('discontinu') || s.includes('punteada') || s.includes('dashed') || s.includes('dotted'))
    return 'dependencia';

  return 'asociacion';
};

/** Cualquier notacion de "muchos" se reduce a '*'. */
const normMult = (v: unknown): '1' | '*' => {
  const s = String(v ?? '1').trim().toLowerCase();
  if (s === '*' || s.includes('..') || s === 'n' || s === 'm' || s.includes('muchos') || s.includes('many'))
    return '*';
  return '1';
};

const nombreValido = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '' || s.length > 80) return null;
  return s;
};

function normAtributos(raw: unknown): Array<{ name: string; datatype: Datatype; scope: Scope }> {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const out: Array<{ name: string; datatype: Datatype; scope: Scope }> = [];
  for (const a of raw) {
    const nombre = nombreValido((a as Record<string, unknown>)?.name);
    if (!nombre) continue;
    // El 'id' lo agrega el generador: si el modelo lo propone, se descarta.
    if (nombre.toLowerCase() === 'id') continue;
    const clave = nombre.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const r = a as Record<string, unknown>;
    out.push({
      name: nombre,
      datatype: normDatatype(r.datatype ?? r.type),
      scope: normScope(r.scope ?? r.visibility),
    });
  }
  return out;
}

export interface AccionValidada {
  type: 'create' | 'update' | 'delete';
  target: 'class' | 'attribute' | 'edge';
  data: Record<string, unknown>;
}

export interface ResultadoValidacion {
  actions: AccionValidada[];
  /** Acciones descartadas, con el motivo. Se devuelven para poder mostrarlas y depurar. */
  descartadas: Array<{ motivo: string; accion: unknown }>;
}

/**
 * Valida y normaliza la lista de acciones.
 * Descarta lo que no encaje en vez de dejarlo pasar: una accion mal formada que
 * llega al editor produce un nodo corrupto en el documento compartido, que es
 * mucho peor que una accion perdida.
 */
export function validarAcciones(raw: unknown): ResultadoValidacion {
  const lista = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.actions)
      ? ((raw as Record<string, unknown>).actions as unknown[])
      : [];

  const actions: AccionValidada[] = [];
  const descartadas: Array<{ motivo: string; accion: unknown }> = [];
  const push = (motivo: string, accion: unknown) => descartadas.push({ motivo, accion });

  for (const item of lista.slice(0, 60)) {
    const a = item as Record<string, unknown>;
    const type = String(a?.type ?? '').trim().toLowerCase();
    const target = String(a?.target ?? '').trim().toLowerCase();
    const data = (a?.data ?? {}) as Record<string, unknown>;

    if (!['create', 'update', 'delete'].includes(type)) {
      push(`tipo de accion no reconocido: "${a?.type}"`, item);
      continue;
    }
    if (!['class', 'attribute', 'edge'].includes(target)) {
      push(`objetivo no reconocido: "${a?.target}"`, item);
      continue;
    }

    // ---- clases ----
    if (target === 'class' && type === 'create') {
      const label = nombreValido(data.label ?? data.name);
      if (!label) {
        push('clase sin nombre valido', item);
        continue;
      }
      const asociativa = data.asociativa === true;
      const relaciona = Array.isArray(data.relaciona)
        ? (data.relaciona as unknown[]).map(nombreValido).filter((x): x is string => Boolean(x))
        : [];
      if (asociativa && relaciona.length !== 2) {
        // Una clase asociativa sin sus dos extremos no puede generar la tabla
        // intermedia: se acepta como clase normal en vez de descartarla.
        push('clase asociativa sin dos extremos: se acepta como clase normal', item);
        actions.push({
          type: 'create',
          target: 'class',
          data: { label, attributes: normAtributos(data.attributes), asociativa: false },
        });
        continue;
      }
      actions.push({
        type: 'create',
        target: 'class',
        data: {
          label,
          attributes: normAtributos(data.attributes),
          ...(asociativa ? { asociativa: true, relaciona } : { asociativa: false }),
        },
      });
      continue;
    }

    if (target === 'class' && (type === 'update' || type === 'delete')) {
      const ref = nombreValido(data.id ?? data.label ?? data.name);
      if (!ref) {
        push('accion sobre clase sin referencia', item);
        continue;
      }
      const salida: Record<string, unknown> = { id: ref };
      if (type === 'update') {
        const nuevo = nombreValido(data.label);
        if (nuevo) salida.label = nuevo;
        if (Array.isArray(data.attributes)) salida.attributes = normAtributos(data.attributes);
        if (!salida.label && !salida.attributes) {
          push('actualizacion de clase sin cambios', item);
          continue;
        }
      }
      actions.push({ type: type as 'update' | 'delete', target: 'class', data: salida });
      continue;
    }

    // ---- atributos ----
    if (target === 'attribute' && type === 'create') {
      // classLabel lo emite el prompt de dominio; los demas nombres los emite el
      // modelo cuando improvisa. Aceptarlos todos evita perder los atributos de un
      // modelo completo por una diferencia de nombre de campo.
      const clase = nombreValido(
        data.classId ?? data.classLabel ?? data.className ?? data.class ?? data.label
      );
      const nombre = nombreValido(data.name);
      if (!clase || !nombre) {
        push('atributo sin clase o sin nombre', item);
        continue;
      }
      if (nombre.toLowerCase() === 'id') {
        push('el atributo "id" es implicito', item);
        continue;
      }
      actions.push({
        type: 'create',
        target: 'attribute',
        data: {
          classId: clase,
          name: nombre,
          datatype: normDatatype(data.datatype ?? data.type),
          scope: normScope(data.scope),
        },
      });
      continue;
    }

    // ---- relaciones ----
    if (target === 'edge' && type === 'create') {
      const origen = nombreValido(data.sourceLabel ?? data.source ?? data.from);
      const destino = nombreValido(data.targetLabel ?? data.target ?? data.to);
      if (!origen || !destino) {
        push('relacion sin origen o sin destino', item);
        continue;
      }
      if (origen.toLowerCase() === destino.toLowerCase()) {
        push('relacion de una clase consigo misma', item);
        continue;
      }
      const tipo = normTipo(data.tipo ?? data.type);
      let mo = normMult(data.multiplicidadOrigen ?? data.sourceMultiplicity);
      let md = normMult(data.multiplicidadDestino ?? data.targetMultiplicity);

      // La herencia no lleva multiplicidades en UML.
      if (tipo === 'herencia') {
        mo = '1';
        md = '1';
      }
      // Muchos a muchos directo: el modelo relacional no lo admite sin tabla
      // intermedia. Se degrada a 1:* y se informa, en vez de generar un esquema
      // que despues no se puede mapear.
      if (mo === '*' && md === '*') {
        push('muchos a muchos sin clase asociativa: se degrada a 1:*', item);
        mo = '1';
      }
      actions.push({
        type: 'create',
        target: 'edge',
        data: {
          sourceLabel: origen,
          targetLabel: destino,
          tipo,
          multiplicidadOrigen: mo,
          multiplicidadDestino: md,
        },
      });
      continue;
    }

    if (target === 'edge' && type === 'delete') {
      const id = nombreValido(data.id);
      if (!id) {
        push('eliminacion de relacion sin identificador', item);
        continue;
      }
      actions.push({ type: 'delete', target: 'edge', data: { id } });
      continue;
    }

    push(`combinacion no soportada: ${type} ${target}`, item);
  }

  // Las clases se aplican antes que las relaciones: el servidor rechaza una
  // arista cuyos extremos no existen todavia en el documento.
  // Una clase asociativa nombra en "relaciona" dos clases que puede estar creando
  // la misma respuesta, asi que va DESPUES de las clases normales. Antes ambas
  // pesaban 0 y el orden dependia de como las hubiera emitido el modelo.
  const peso = (a: AccionValidada): number => {
    if (a.target === 'class' && a.type === 'create') return a.data.asociativa === true ? 1 : 0;
    if (a.target === 'attribute') return 2;
    if (a.target === 'edge') return 3;
    return 2;
  };
  actions.sort((x, y) => peso(x) - peso(y)); // Array.sort es estable desde ES2019

  return { actions, descartadas };
}

export interface ClaseReconocida {
  label: string;
  attributes: Array<{ name: string; datatype: Datatype; scope: Scope }>;
  asociativa: boolean;
  relaciona?: [string, string];
}

export interface RelacionReconocida {
  sourceLabel: string;
  targetLabel: string;
  tipo: Tipo;
  multiplicidadOrigen: '1' | '*';
  multiplicidadDestino: '1' | '*';
}

/** Valida y normaliza el diagrama reconocido en una imagen. */
export function validarDiagramaReconocido(raw: unknown): {
  classes: ClaseReconocida[];
  relations: RelacionReconocida[];
  descartadas: Array<{ motivo: string; accion: unknown }>;
} {
  const r = (raw ?? {}) as Record<string, unknown>;
  const descartadas: Array<{ motivo: string; accion: unknown }> = [];

  const vistas = new Set<string>();
  const classes: ClaseReconocida[] = [];
  for (const c of Array.isArray(r.classes) ? (r.classes as unknown[]).slice(0, 80) : []) {
    const item = c as Record<string, unknown>;
    const label = nombreValido(item.label ?? item.name);
    if (!label) {
      descartadas.push({ motivo: 'clase sin nombre', accion: c });
      continue;
    }
    const clave = label.toLowerCase();
    if (vistas.has(clave)) {
      descartadas.push({ motivo: `clase duplicada: ${label}`, accion: c });
      continue;
    }
    vistas.add(clave);

    const rel = Array.isArray(item.relaciona)
      ? (item.relaciona as unknown[]).map(nombreValido).filter((x): x is string => Boolean(x))
      : [];
    classes.push({
      label,
      attributes: normAtributos(item.attributes),
      asociativa: item.asociativa === true && rel.length === 2,
      ...(rel.length === 2 ? { relaciona: [rel[0], rel[1]] as [string, string] } : {}),
    });
  }

  const relations: RelacionReconocida[] = [];
  const clavesRel = new Set<string>();
  for (const e of Array.isArray(r.relations) ? (r.relations as unknown[]).slice(0, 200) : []) {
    const item = e as Record<string, unknown>;
    const origen = nombreValido(item.sourceLabel ?? item.source);
    const destino = nombreValido(item.targetLabel ?? item.target);
    if (!origen || !destino) {
      descartadas.push({ motivo: 'relacion incompleta', accion: e });
      continue;
    }
    // Solo relaciones entre clases efectivamente reconocidas.
    if (!vistas.has(origen.toLowerCase()) || !vistas.has(destino.toLowerCase())) {
      descartadas.push({ motivo: `relacion con clase inexistente: ${origen} - ${destino}`, accion: e });
      continue;
    }
    if (origen.toLowerCase() === destino.toLowerCase()) {
      descartadas.push({ motivo: 'relacion reflexiva', accion: e });
      continue;
    }
    const tipo = normTipo(item.tipo ?? item.type);
    const clave = `${origen.toLowerCase()}|${destino.toLowerCase()}|${tipo}`;
    if (clavesRel.has(clave)) {
      descartadas.push({ motivo: 'relacion duplicada', accion: e });
      continue;
    }
    clavesRel.add(clave);
    relations.push({
      sourceLabel: origen,
      targetLabel: destino,
      tipo,
      multiplicidadOrigen:
        tipo === 'herencia' ? '1' : normMult(item.multiplicidadOrigen ?? item.sourceMultiplicity),
      multiplicidadDestino:
        tipo === 'herencia' ? '1' : normMult(item.multiplicidadDestino ?? item.targetMultiplicity),
    });
  }

  return { classes, relations, descartadas };
}

/**
 * Rescata los objetos JSON completos de una respuesta truncada.
 *
 * Cuando el modelo local se queda sin num_predict a mitad del JSON,
 * parseJsonLoose falla y se pierde todo lo que SI estaba bien formado. Esto
 * recorre el texto y devuelve todos los objetos que cierran correctamente.
 *
 * La pila es necesaria: los objetos van anidados dentro de {"classes": [ ... ]}
 * o {"actions": [ ... ]}, que en una respuesta truncada nunca cierran, asi que
 * mirar solo el nivel exterior devuelve cero. Las comillas se siguen con su
 * escape para no contar una llave que este dentro de una cadena.
 */
export function rescatarObjetosParciales(text: string): Array<Record<string, unknown>> {
  const objetos: Array<Record<string, unknown>> = [];
  const pila: number[] = [];
  let enCadena = false;
  let escapado = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (enCadena) {
      if (escapado) escapado = false;
      else if (ch === '\\') escapado = true;
      else if (ch === '"') enCadena = false;
      continue;
    }
    if (ch === '"') { enCadena = true; continue; }
    if (ch === '{') { pila.push(i); continue; }
    if (ch === '}') {
      const inicio = pila.pop();
      if (inicio === undefined) continue;
      try {
        const obj = JSON.parse(text.slice(inicio, i + 1));
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          objetos.push(obj as Record<string, unknown>);
        }
      } catch {
        /* fragmento no parseable: se ignora */
      }
    }
  }
  return objetos;
}

/** Acciones completas de una respuesta truncada del modo atomico. */
export function rescatarAccionesParciales(text: string): unknown[] {
  return rescatarObjetosParciales(text).filter(o => 'type' in o && 'target' in o);
}

/** Clases completas de una respuesta truncada de la etapa 1 del modo dominio. */
export function rescatarClasesParciales(text: string): unknown[] {
  // Los objetos de atributo tambien cierran bien y tambien tienen "name", asi
  // que se exige "label" o la lista de atributos para no confundirlos.
  return rescatarObjetosParciales(text).filter(
    o => 'label' in o || ('attributes' in o && Array.isArray(o.attributes))
  );
}

/** Relaciones completas de una respuesta truncada de la etapa 2. */
export function rescatarRelacionesParciales(text: string): unknown[] {
  return rescatarObjetosParciales(text).filter(o => 'sourceLabel' in o && 'targetLabel' in o);
}
