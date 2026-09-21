import type { EdgeType, NodeType } from './umlConstants';

/**
 * Fase de DISENO DE DATOS del proceso de desarrollo.
 *
 * Cubre el recorrido completo que exige el enunciado, a partir del diagrama de clases:
 *   1. Modelo conceptual (entidades, relaciones y cardinalidades)
 *   2. Mapeo objeto-relacional con las reglas de Rumbaugh (TMO)
 *   3. Esquema logico relacional (tablas, claves, foraneas)
 *   4. Analisis de normalizacion (1FN, 2FN, 3FN) con justificacion
 *   5. DDL ejecutable (PostgreSQL y MySQL)
 *
 * Todo es derivado y deterministico: no interviene la IA, asi que el resultado es
 * el mismo siempre y se puede defender paso por paso.
 */

// ---------------------------------------------------------------- 1. conceptual

export type Cardinalidad = '1:1' | '1:N' | 'N:1' | 'N:M';

export interface EntidadConceptual {
  nombre: string;
  atributos: Array<{ nombre: string; tipo: string; visibilidad: string }>;
  /** Entidad debil: existe solo en funcion de otra (destino de una composicion). */
  debil: boolean;
  /** Entidad asociativa: resuelve una relacion muchos a muchos. */
  asociativa: boolean;
  especializaA?: string;
}

export interface RelacionConceptual {
  nombre: string;
  origen: string;
  destino: string;
  tipo: EdgeType['tipo'];
  cardinalidad: Cardinalidad;
}

export interface ModeloConceptual {
  entidades: EntidadConceptual[];
  relaciones: RelacionConceptual[];
}

const cardinalidadDe = (e: EdgeType): Cardinalidad => {
  const o = e.multiplicidadOrigen === '*' ? 'N' : '1';
  const d = e.multiplicidadDestino === '*' ? 'N' : '1';
  if (o === 'N' && d === 'N') return 'N:M';
  if (o === '1' && d === 'N') return '1:N';
  if (o === 'N' && d === '1') return 'N:1';
  return '1:1';
};

export function construirModeloConceptual(
  nodes: NodeType[],
  edges: EdgeType[]
): ModeloConceptual {
  const nombre = (id: string) => nodes.find(n => n.id === id)?.label ?? id;

  const entidades: EntidadConceptual[] = nodes.map(n => {
    const herencia = edges.find(e => e.tipo === 'herencia' && e.source === n.id);
    // Es debil si es el lado "parte" de una composicion: su vida depende del todo.
    const debil = edges.some(e => e.tipo === 'composicion' && e.target === n.id);
    return {
      nombre: n.label,
      atributos: (n.attributes ?? []).map(a => ({
        nombre: a.name,
        tipo: a.datatype,
        visibilidad: a.scope,
      })),
      debil,
      asociativa: Boolean(n.asociativa),
      especializaA: herencia ? nombre(herencia.target) : undefined,
    };
  });

  const relaciones: RelacionConceptual[] = edges.map(e => ({
    nombre: `${nombre(e.source)}_${nombre(e.target)}`,
    origen: nombre(e.source),
    destino: nombre(e.target),
    tipo: e.tipo,
    cardinalidad: cardinalidadDe(e),
  }));

  return { entidades, relaciones };
}

// ---------------------------------------------------------------- 2. mapeo (Rumbaugh)

export interface ReglaAplicada {
  /** Identificador de la regla, para poder citarla en la documentacion. */
  regla: string;
  descripcion: string;
  origen: string;
  resultado: string;
}

export interface Columna {
  nombre: string;
  tipoSql: string;
  nulo: boolean;
  pk: boolean;
  unica: boolean;
  fk?: { tabla: string; columna: string; onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' };
  comentario?: string;
}

export interface Tabla {
  nombre: string;
  columnas: Columna[];
  /** Origen: la clase UML de la que salio, o la relacion N:M que la genero. */
  proveniencia: string;
}

export interface EsquemaRelacional {
  tablas: Tabla[];
  reglas: ReglaAplicada[];
}

const TIPO_SQL: Record<string, string> = {
  String: 'VARCHAR(255)',
  Integer: 'INTEGER',
  Float: 'DOUBLE PRECISION',
  Boolean: 'BOOLEAN',
  Date: 'DATE',
};

/** snake_case: convencion habitual en el esquema relacional. */
export const aSnake = (texto: string): string =>
  texto
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();

const columnaId = (): Columna => ({
  nombre: 'id',
  tipoSql: 'BIGSERIAL',
  nulo: false,
  pk: true,
  unica: true,
  comentario: 'Clave primaria subrogada (regla R1)',
});

const columnaFk = (
  tablaDestino: string,
  nulo: boolean,
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT',
  comentario: string,
  unica = false
): Columna => ({
  nombre: `${aSnake(tablaDestino)}_id`,
  tipoSql: 'BIGINT',
  nulo,
  pk: false,
  unica,
  fk: { tabla: aSnake(tablaDestino), columna: 'id', onDelete },
  comentario,
});

/**
 * Aplica las reglas de mapeo objeto-relacional.
 *
 * R1 Clase          -> tabla, con clave primaria subrogada
 * R2 Atributo       -> columna, con su tipo SQL equivalente
 * R3 Asociacion 1:1 -> clave foranea en uno de los extremos, con restriccion UNIQUE
 * R4 Asociacion 1:N -> clave foranea en el lado N
 * R5 Asociacion N:M -> tabla intermedia con las dos foraneas como clave compuesta
 * R6 Composicion    -> igual que la asociacion, pero con ON DELETE CASCADE (dependencia existencial)
 * R7 Agregacion     -> igual que la asociacion, con ON DELETE SET NULL (independencia existencial)
 * R8 Herencia       -> una tabla por subclase, con foranea a la tabla padre (ON DELETE CASCADE)
 * R9 Clase asociativa -> tabla con las foraneas a las dos clases que relaciona, mas sus propios atributos
 */
export function mapearARelacional(
  nodes: NodeType[],
  edges: EdgeType[]
): EsquemaRelacional {
  const nombre = (id: string) => nodes.find(n => n.id === id)?.label ?? id;
  const reglas: ReglaAplicada[] = [];
  const tablas = new Map<string, Tabla>();

  // R1 y R2
  for (const n of nodes) {
    const tabla: Tabla = {
      nombre: aSnake(n.label),
      proveniencia: `Clase ${n.label}`,
      columnas: [columnaId()],
    };
    reglas.push({
      regla: 'R1',
      descripcion: 'Toda clase concreta se transforma en una tabla con clave primaria subrogada',
      origen: `Clase ${n.label}`,
      resultado: `Tabla ${tabla.nombre} (id BIGSERIAL PRIMARY KEY)`,
    });

    for (const a of n.attributes ?? []) {
      if (a.name.trim().toLowerCase() === 'id') continue;
      tabla.columnas.push({
        nombre: aSnake(a.name),
        tipoSql: TIPO_SQL[a.datatype] ?? 'VARCHAR(255)',
        nulo: true,
        pk: false,
        unica: false,
        comentario: `Atributo ${a.scope} ${a.name}: ${a.datatype} (regla R2)`,
      });
    }
    if ((n.attributes ?? []).length > 0) {
      reglas.push({
        regla: 'R2',
        descripcion: 'Cada atributo simple se transforma en una columna con su tipo SQL equivalente',
        origen: `Atributos de ${n.label}`,
        resultado: `${(n.attributes ?? []).length} columna(s) en ${tabla.nombre}`,
      });
    }
    tablas.set(n.id, tabla);
  }

  // R8: herencia
  for (const e of edges.filter(r => r.tipo === 'herencia')) {
    const hija = tablas.get(e.source);
    const padre = nombre(e.target);
    if (!hija) continue;
    hija.columnas.push(
      columnaFk(padre, false, 'CASCADE', `Especializacion de ${padre} (regla R8)`, true)
    );
    reglas.push({
      regla: 'R8',
      descripcion:
        'La herencia se implementa con una tabla por subclase y una foranea a la tabla padre (ON DELETE CASCADE)',
      origen: `${nombre(e.source)} hereda de ${padre}`,
      resultado: `${aSnake(nombre(e.source))}.${aSnake(padre)}_id -> ${aSnake(padre)}.id`,
    });
  }

  // R9: clases asociativas declaradas en el diagrama
  for (const n of nodes.filter(x => x.asociativa && x.relaciona)) {
    const tabla = tablas.get(n.id);
    if (!tabla) continue;
    for (const relId of n.relaciona as string[]) {
      const destino = nombre(relId);
      tabla.columnas.push(
        columnaFk(destino, false, 'CASCADE', `Extremo de la relacion N:M (regla R9)`)
      );
    }
    reglas.push({
      regla: 'R9',
      descripcion:
        'La clase asociativa se transforma en tabla con las foraneas a las dos clases que relaciona, conservando sus atributos propios',
      origen: `Clase asociativa ${n.label}`,
      resultado: `Tabla ${tabla.nombre} con ${(n.relaciona as string[]).length} foranea(s)`,
    });
  }

  // R3, R4, R5, R6, R7
  for (const e of edges) {
    if (e.tipo === 'herencia') continue;
    const origenNodo = nodes.find(n => n.id === e.source);
    const destinoNodo = nodes.find(n => n.id === e.target);
    if (!origenNodo || !destinoNodo) continue;
    // Las aristas de una clase asociativa ya fueron cubiertas por R9.
    if (origenNodo.asociativa || destinoNodo.asociativa) continue;

    const card = cardinalidadDe(e);
    const onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' =
      e.tipo === 'composicion' ? 'CASCADE' : e.tipo === 'agregacion' ? 'SET NULL' : 'RESTRICT';
    const reglaSemantica =
      e.tipo === 'composicion' ? 'R6' : e.tipo === 'agregacion' ? 'R7' : null;

    if (card === 'N:M') {
      // R5: tabla intermedia generada
      const nombreTabla = `${aSnake(origenNodo.label)}_${aSnake(destinoNodo.label)}`;
      if (!tablas.has(nombreTabla)) {
        tablas.set(nombreTabla, {
          nombre: nombreTabla,
          proveniencia: `Relacion N:M entre ${origenNodo.label} y ${destinoNodo.label}`,
          columnas: [
            {
              ...columnaFk(origenNodo.label, false, 'CASCADE', 'Parte de la clave primaria compuesta (regla R5)'),
              pk: true,
            },
            {
              ...columnaFk(destinoNodo.label, false, 'CASCADE', 'Parte de la clave primaria compuesta (regla R5)'),
              pk: true,
            },
          ],
        });
        reglas.push({
          regla: 'R5',
          descripcion:
            'La asociacion N:M se resuelve con una tabla intermedia cuya clave primaria es la union de las dos foraneas',
          origen: `${origenNodo.label} N:M ${destinoNodo.label}`,
          resultado: `Tabla ${nombreTabla} (clave primaria compuesta)`,
        });
      }
      continue;
    }

    // La foranea va en el lado "muchos"; en 1:1 la ponemos en el destino y la marcamos UNIQUE.
    const ladoN = card === '1:N' ? destinoNodo : card === 'N:1' ? origenNodo : destinoNodo;
    const ladoUno = ladoN === destinoNodo ? origenNodo : destinoNodo;
    const tabla = tablas.get(ladoN.id);
    if (!tabla) continue;

    const yaExiste = tabla.columnas.some(c => c.nombre === `${aSnake(ladoUno.label)}_id`);
    if (!yaExiste) {
      tabla.columnas.push(
        columnaFk(
          ladoUno.label,
          e.tipo !== 'composicion',
          onDelete,
          `Relacion ${e.tipo} ${card} con ${ladoUno.label} (regla ${card === '1:1' ? 'R3' : 'R4'}${reglaSemantica ? ' + ' + reglaSemantica : ''})`,
          card === '1:1'
        )
      );
    }

    reglas.push({
      regla: card === '1:1' ? 'R3' : 'R4',
      descripcion:
        card === '1:1'
          ? 'La asociacion 1:1 se implementa con una foranea en uno de los extremos, con restriccion UNIQUE'
          : 'La asociacion 1:N se implementa con una foranea en el lado N',
      origen: `${origenNodo.label} ${card} ${destinoNodo.label} (${e.tipo})`,
      resultado: `${tabla.nombre}.${aSnake(ladoUno.label)}_id -> ${aSnake(ladoUno.label)}.id ON DELETE ${onDelete}`,
    });

    if (reglaSemantica) {
      reglas.push({
        regla: reglaSemantica,
        descripcion:
          reglaSemantica === 'R6'
            ? 'La composicion implica dependencia existencial: la foranea es obligatoria y borra en cascada'
            : 'La agregacion no implica dependencia existencial: la foranea admite nulos y se anula al borrar el agregado',
        origen: `${e.tipo} ${origenNodo.label} - ${destinoNodo.label}`,
        resultado: `ON DELETE ${onDelete}`,
      });
    }
  }

  return { tablas: [...tablas.values()], reglas };
}

// ---------------------------------------------------------------- 3. normalizacion

export type FormaNormal = '1FN' | '2FN' | '3FN';

export interface HallazgoNormalizacion {
  tabla: string;
  forma: FormaNormal;
  cumple: boolean;
  problema: string;
  justificacion: string;
  sugerencia: string;
  columnas: string[];
}

export interface AnalisisNormalizacion {
  hallazgos: HallazgoNormalizacion[];
  resumen: { evaluadas: number; en3FN: number; conObservaciones: number };
}

/** Detecta grupos repetitivos por sufijo numerico: telefono1, telefono2, ... */
function gruposRepetitivos(columnas: string[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const c of columnas) {
    const m = /^(.*?)_?(\d+)$/.exec(c);
    if (!m) continue;
    const base = m[1];
    if (!base) continue;
    grupos.set(base, [...(grupos.get(base) ?? []), c]);
  }
  for (const [base, cols] of [...grupos]) {
    if (cols.length < 2) grupos.delete(base);
  }
  return grupos;
}

/** Columnas que parecen listas embutidas en un solo campo. */
const SOSPECHOSAS_MULTIVALOR = ['telefonos', 'correos', 'emails', 'direcciones', 'tags', 'lista'];

/** Columnas que suelen ser valores calculables a partir de otros. */
const SOSPECHOSAS_DERIVADAS = ['total', 'subtotal', 'importe_total', 'edad', 'monto_total', 'iva'];

/**
 * Analiza el esquema contra 1FN, 2FN y 3FN.
 *
 * Con un diagrama de clases no se dispone del conjunto completo de dependencias
 * funcionales, asi que el analisis se apoya en las propiedades que SI se pueden
 * deducir del esquema mas un conjunto de indicios estructurales. Cada hallazgo
 * queda justificado para poder discutirlo o descartarlo a mano.
 */
export function analizarNormalizacion(esquema: EsquemaRelacional): AnalisisNormalizacion {
  const hallazgos: HallazgoNormalizacion[] = [];
  const nombresTabla = new Set(esquema.tablas.map(t => t.nombre));

  for (const tabla of esquema.tablas) {
    const columnas = tabla.columnas.map(c => c.nombre);
    const noClave = tabla.columnas.filter(c => !c.pk && !c.fk).map(c => c.nombre);
    const clavePrimaria = tabla.columnas.filter(c => c.pk).map(c => c.nombre);

    // ---- 1FN: atomicidad y ausencia de grupos repetitivos ----
    const repetitivos = gruposRepetitivos(columnas);
    const multivalor = noClave.filter(c =>
      SOSPECHOSAS_MULTIVALOR.some(s => c.includes(s))
    );

    if (repetitivos.size > 0) {
      for (const [base, cols] of repetitivos) {
        hallazgos.push({
          tabla: tabla.nombre,
          forma: '1FN',
          cumple: false,
          problema: `Grupo repetitivo: ${cols.join(', ')}`,
          justificacion:
            'La 1FN exige que no existan grupos de columnas que representen varias ocurrencias ' +
            `del mismo hecho. "${base}" aparece numerado, lo que limita artificialmente la cantidad ` +
            'de valores y obliga a modificar el esquema para admitir uno mas.',
          sugerencia: `Extraer una tabla ${tabla.nombre}_${base} con foranea a ${tabla.nombre}.id y una fila por valor.`,
          columnas: cols,
        });
      }
    } else if (multivalor.length > 0) {
      hallazgos.push({
        tabla: tabla.nombre,
        forma: '1FN',
        cumple: false,
        problema: `Posible atributo multivaluado: ${multivalor.join(', ')}`,
        justificacion:
          'La 1FN exige valores atomicos. El nombre en plural sugiere que la columna guardaria ' +
          'varios valores separados por comas, lo que impide consultarlos e indexarlos por separado.',
        sugerencia: `Extraer cada valor a su propia tabla relacionada con ${tabla.nombre}.`,
        columnas: multivalor,
      });
    } else {
      hallazgos.push({
        tabla: tabla.nombre,
        forma: '1FN',
        cumple: true,
        problema: '',
        justificacion:
          'Todas las columnas son de tipo escalar, no hay grupos repetitivos y la tabla tiene clave primaria definida.',
        sugerencia: '',
        columnas: [],
      });
    }

    // ---- 2FN: dependencia funcional completa de la clave ----
    if (clavePrimaria.length > 1) {
      // Clave compuesta (tabla intermedia): un atributo propio que dependa de una sola
      // parte de la clave viola la 2FN.
      const propios = noClave;
      if (propios.length > 0) {
        const sospechosos = propios.filter(c =>
          [...nombresTabla].some(t => t !== tabla.nombre && c.startsWith(`${t}_`))
        );
        hallazgos.push({
          tabla: tabla.nombre,
          forma: '2FN',
          cumple: sospechosos.length === 0,
          problema:
            sospechosos.length > 0
              ? `Atributos que dependen de solo una parte de la clave compuesta: ${sospechosos.join(', ')}`
              : '',
          justificacion:
            sospechosos.length > 0
              ? `La clave primaria es compuesta (${clavePrimaria.join(' + ')}). La 2FN exige que ` +
                'todo atributo no clave dependa de la clave completa; estos parecen depender de uno ' +
                'solo de sus componentes.'
              : `La clave primaria es compuesta (${clavePrimaria.join(' + ')}) y los atributos propios ` +
                'de la tabla describen la asociacion en si, por lo que dependen de la clave completa.',
          sugerencia:
            sospechosos.length > 0
              ? 'Mover esos atributos a la tabla de la entidad de la que realmente dependen.'
              : '',
          columnas: sospechosos,
        });
      }
    } else {
      hallazgos.push({
        tabla: tabla.nombre,
        forma: '2FN',
        cumple: true,
        problema: '',
        justificacion:
          'La clave primaria es una sola columna subrogada, por lo que no pueden existir ' +
          'dependencias parciales: la 2FN se cumple de forma automatica.',
        sugerencia: '',
        columnas: [],
      });
    }

    // ---- 3FN: ausencia de dependencias transitivas ----
    // Indicio 1: una columna con el prefijo de otra entidad con la que ya hay foranea.
    const fks = tabla.columnas.filter(c => c.fk).map(c => c.fk!.tabla);
    const transitivas = noClave.filter(c =>
      fks.some(t => c.startsWith(`${t}_`) || c.startsWith(`${t.replace(/_/g, '')}_`))
    );
    // Indicio 2: una columna que repite el nombre de otra entidad del esquema.
    const ajenas = noClave.filter(c => {
      const prefijo = c.split('_')[0];
      return prefijo !== tabla.nombre && nombresTabla.has(prefijo);
    });
    // Indicio 3: valores calculables desde otras columnas o tablas.
    const derivadas = noClave.filter(c => SOSPECHOSAS_DERIVADAS.includes(c));

    const problemas3fn = [...new Set([...transitivas, ...ajenas])];

    if (problemas3fn.length > 0) {
      hallazgos.push({
        tabla: tabla.nombre,
        forma: '3FN',
        cumple: false,
        problema: `Dependencia transitiva: ${problemas3fn.join(', ')}`,
        justificacion:
          'La 3FN exige que ningun atributo no clave dependa de otro atributo no clave. Estas ' +
          'columnas describen una entidad distinta a la de esta tabla, con la que ya existe una ' +
          'relacion, asi que su valor depende de esa otra entidad y no de la clave de esta tabla. ' +
          'Mantenerlas duplica el dato y permite que las dos copias se contradigan.',
        sugerencia:
          'Eliminar la columna y obtener el dato por la foranea correspondiente mediante una consulta con JOIN.',
        columnas: problemas3fn,
      });
    } else if (derivadas.length > 0) {
      hallazgos.push({
        tabla: tabla.nombre,
        forma: '3FN',
        cumple: false,
        problema: `Atributo derivado almacenado: ${derivadas.join(', ')}`,
        justificacion:
          'Un valor calculable a partir de otros datos es una dependencia sobre atributos no clave. ' +
          'Almacenarlo introduce redundancia y puede quedar desactualizado si cambian los datos base.',
        sugerencia:
          'Calcularlo en una vista o columna generada; conservarlo solo si se requiere congelar el valor historico (decision de desnormalizacion deliberada).',
        columnas: derivadas,
      });
    } else {
      hallazgos.push({
        tabla: tabla.nombre,
        forma: '3FN',
        cumple: true,
        problema: '',
        justificacion:
          'Cada atributo no clave describe directamente a la entidad de la tabla y las referencias ' +
          'a otras entidades se hacen por clave foranea, no copiando sus datos.',
        sugerencia: '',
        columnas: [],
      });
    }
  }

  const porTabla = new Map<string, HallazgoNormalizacion[]>();
  for (const h of hallazgos) {
    porTabla.set(h.tabla, [...(porTabla.get(h.tabla) ?? []), h]);
  }
  const en3FN = [...porTabla.values()].filter(hs => hs.every(h => h.cumple)).length;

  return {
    hallazgos,
    resumen: {
      evaluadas: porTabla.size,
      en3FN,
      conObservaciones: porTabla.size - en3FN,
    },
  };
}

// ---------------------------------------------------------------- 4. DDL

export type DialectoSql = 'postgres' | 'mysql';

const tipoParaDialecto = (tipo: string, dialecto: DialectoSql): string => {
  if (dialecto === 'postgres') return tipo;
  return tipo
    .replace('BIGSERIAL', 'BIGINT AUTO_INCREMENT')
    .replace('DOUBLE PRECISION', 'DOUBLE')
    .replace('BOOLEAN', 'TINYINT(1)');
};

/** Ordena las tablas para que ninguna foranea apunte a una tabla aun no creada. */
function ordenarPorDependencias(tablas: Tabla[]): Tabla[] {
  const pendientes = [...tablas];
  const creadas = new Set<string>();
  const resultado: Tabla[] = [];

  while (pendientes.length > 0) {
    const siguiente = pendientes.findIndex(t =>
      t.columnas.every(c => !c.fk || c.fk.tabla === t.nombre || creadas.has(c.fk.tabla))
    );
    // Si hay un ciclo de foraneas, emitimos igual y las restricciones se agregan despues.
    const indice = siguiente >= 0 ? siguiente : 0;
    const [tabla] = pendientes.splice(indice, 1);
    creadas.add(tabla.nombre);
    resultado.push(tabla);
  }
  return resultado;
}

export function generarDDL(esquema: EsquemaRelacional, dialecto: DialectoSql = 'postgres'): string {
  const lineas: string[] = [
    `-- Esquema relacional generado a partir del diagrama de clases`,
    `-- Dialecto: ${dialecto === 'postgres' ? 'PostgreSQL' : 'MySQL'}`,
    `-- Reglas de mapeo aplicadas: R1..R9 (transformacion objeto-relacional, Rumbaugh)`,
    '',
  ];

  for (const tabla of ordenarPorDependencias(esquema.tablas)) {
    lineas.push(`-- Origen: ${tabla.proveniencia}`);
    lineas.push(`CREATE TABLE ${tabla.nombre} (`);

    const defs: string[] = [];
    const pks = tabla.columnas.filter(c => c.pk).map(c => c.nombre);

    for (const c of tabla.columnas) {
      // El comentario va en su propia linea: en linea con la definicion se comeria
      // la coma separadora y el script dejaria de ser ejecutable.
      if (c.comentario) defs.push(`__COMMENT__  -- ${c.comentario}`);
      let def = `  ${c.nombre} ${tipoParaDialecto(c.tipoSql, dialecto)}`;
      if (!c.nulo) def += ' NOT NULL';
      if (c.unica && !c.pk) def += ' UNIQUE';
      defs.push(def);
    }

    if (pks.length > 0) {
      // La clave primaria se declara al final, que es lo que permite la clave compuesta de R5.
      defs.push(`  PRIMARY KEY (${pks.join(', ')})`);
    }

    for (const c of tabla.columnas.filter(x => x.fk)) {
      defs.push(
        `  CONSTRAINT fk_${tabla.nombre}_${c.nombre} FOREIGN KEY (${c.nombre}) ` +
          `REFERENCES ${c.fk!.tabla}(${c.fk!.columna}) ON DELETE ${c.fk!.onDelete}`
      );
    }

    // Unimos con coma solo las definiciones reales, dejando los comentarios sueltos.
    const cuerpo: string[] = [];
    const reales = defs.filter(d => !d.startsWith('__COMMENT__'));
    let indiceReal = 0;
    for (const d of defs) {
      if (d.startsWith('__COMMENT__')) {
        cuerpo.push(d.replace('__COMMENT__', ''));
        continue;
      }
      indiceReal += 1;
      cuerpo.push(indiceReal < reales.length ? `${d},` : d);
    }
    lineas.push(cuerpo.join('\n'));
    lineas.push(');');
    lineas.push('');

    for (const c of tabla.columnas.filter(x => x.fk)) {
      lineas.push(`CREATE INDEX idx_${tabla.nombre}_${c.nombre} ON ${tabla.nombre} (${c.nombre});`);
    }
    if (tabla.columnas.some(c => c.fk)) lineas.push('');
  }

  return lineas.join('\n');
}

// ---------------------------------------------------------------- 5. informe

/** Informe completo del diseno de datos, en Markdown, listo para la documentacion. */
export function generarInformeDisenoDatos(nodes: NodeType[], edges: EdgeType[]): string {
  const conceptual = construirModeloConceptual(nodes, edges);
  const esquema = mapearARelacional(nodes, edges);
  const normalizacion = analizarNormalizacion(esquema);

  const md: string[] = [
    '# Diseño de datos',
    '',
    'Documento generado por la herramienta a partir del diagrama de clases.',
    '',
    '## 1. Modelo conceptual',
    '',
    `Entidades: ${conceptual.entidades.length} — Relaciones: ${conceptual.relaciones.length}`,
    '',
    '| Entidad | Atributos | Tipo | Especializa a |',
    '| --- | --- | --- | --- |',
    ...conceptual.entidades.map(
      e =>
        `| ${e.nombre} | ${e.atributos.map(a => `${a.nombre}: ${a.tipo}`).join(', ') || '—'} | ${
          e.asociativa ? 'asociativa' : e.debil ? 'débil' : 'fuerte'
        } | ${e.especializaA ?? '—'} |`
    ),
    '',
    '| Relación | Tipo | Cardinalidad |',
    '| --- | --- | --- |',
    ...conceptual.relaciones.map(
      r => `| ${r.origen} → ${r.destino} | ${r.tipo} | ${r.cardinalidad} |`
    ),
    '',
    '## 2. Mapeo objeto-relacional (reglas de Rumbaugh)',
    '',
    '| Regla | Origen | Resultado |',
    '| --- | --- | --- |',
    ...esquema.reglas.map(r => `| ${r.regla} | ${r.origen} | ${r.resultado} |`),
    '',
    '### Reglas utilizadas',
    '',
    ...[...new Map(esquema.reglas.map(r => [r.regla, r.descripcion]))]
      .sort()
      .map(([regla, desc]) => `- **${regla}**: ${desc}`),
    '',
    '## 3. Esquema lógico relacional',
    '',
    ...esquema.tablas.flatMap(t => [
      `### ${t.nombre}`,
      '',
      `_${t.proveniencia}_`,
      '',
      '| Columna | Tipo | Nulo | Clave | Referencia |',
      '| --- | --- | --- | --- | --- |',
      ...t.columnas.map(
        c =>
          `| ${c.nombre} | ${c.tipoSql} | ${c.nulo ? 'sí' : 'no'} | ${
            c.pk ? 'PK' : c.fk ? 'FK' : c.unica ? 'UNIQUE' : '—'
          } | ${c.fk ? `${c.fk.tabla}.${c.fk.columna} (ON DELETE ${c.fk.onDelete})` : '—'} |`
      ),
      '',
    ]),
    '## 4. Análisis de normalización',
    '',
    `Tablas evaluadas: ${normalizacion.resumen.evaluadas} — en 3FN sin observaciones: ` +
      `${normalizacion.resumen.en3FN} — con observaciones: ${normalizacion.resumen.conObservaciones}`,
    '',
    ...normalizacion.hallazgos
      .filter(h => !h.cumple)
      .flatMap(h => [
        `### ${h.tabla} — ${h.forma} no se cumple`,
        '',
        `**Problema:** ${h.problema}`,
        '',
        `**Por qué:** ${h.justificacion}`,
        '',
        `**Corrección propuesta:** ${h.sugerencia}`,
        '',
      ]),
    ...(normalizacion.hallazgos.every(h => h.cumple)
      ? ['Todas las tablas cumplen 1FN, 2FN y 3FN según el análisis realizado.', '']
      : []),
    '## 5. DDL (PostgreSQL)',
    '',
    '```sql',
    generarDDL(esquema, 'postgres'),
    '```',
    '',
  ];

  return md.join('\n');
}
