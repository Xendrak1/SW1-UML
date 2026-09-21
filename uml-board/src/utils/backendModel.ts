import { aSnake, mapearARelacional } from './dataDesign';
import type { EdgeType, NodeType } from './umlConstants';

/**
 * Modelo intermedio entre el diagrama y el codigo Java.
 *
 * Existe para que el generador de backend y el generador de la coleccion de
 * Postman deriven del MISMO mapeo objeto-relacional que documenta las reglas
 * R1..R9 y que produce el DDL.
 *
 * Antes cada generador implementaba su propia interpretacion de las relaciones,
 * y eso produjo tres inconsistencias reales entre el backend y el esquema
 * documentado:
 *   1. el backend nombraba las columnas en camelCase y el DDL en snake_case;
 *   2. el backend ponia la clave foranea en el destino de la flecha en lugar del
 *      lado "muchos", asi que con una relacion modelada al reves quedaba del
 *      lado equivocado;
 *   3. el backend aplicaba borrado en cascada tambien a la agregacion, que por
 *      la regla R7 debe anular la referencia y no propagar el borrado.
 *
 * Con una sola fuente de verdad, esas tres divergencias no pueden reaparecer.
 */

export type ClaseJava = 'id' | 'basic' | 'fk';

export interface CampoJava {
  clase: ClaseJava;
  /** Nombre del campo en Java, en camelCase. */javaName: string;
  /** Tipo Java, o el nombre de la entidad destino cuando es clave foranea. */
  javaType: string;
  /** Nombre de la columna en la base de datos, en snake_case. */
  columna: string;
  /** Entidad referenciada, solo para claves foraneas. */
  targetEntity?: string;
  onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
  nulo: boolean;
  unica: boolean;
}

export interface EntidadJava {
  label: string;
  tabla: string;
  campos: CampoJava[];
}

export interface ModeloJava {
  entidades: EntidadJava[];
  /** Situaciones que el generador no puede resolver y el usuario debe corregir. */
  advertencias: string[];
}

const TIPO_JAVA: Array<[RegExp, string]> = [
  [/^BIGSERIAL|^BIGINT/i, 'Long'],
  [/^INTEGER|^INT\b/i, 'Integer'],
  [/^DOUBLE|^REAL|^NUMERIC|^DECIMAL/i, 'Double'],
  [/^BOOLEAN|^TINYINT/i, 'Boolean'],
  [/^DATE$/i, 'LocalDate'],
  [/^TIMESTAMP/i, 'LocalDateTime'],
  [/^VARCHAR|^TEXT|^CHAR/i, 'String'],
];

const tipoJava = (tipoSql: string): string => {
  for (const [re, java] of TIPO_JAVA) if (re.test(tipoSql)) return java;
  return 'String';
};

/** nombre_de_columna -> nombreDeColumna */
const aCamel = (snake: string): string =>
  snake
    .split('_')
    .filter(Boolean)
    .map((parte, i) => (i === 0 ? parte : parte.charAt(0).toUpperCase() + parte.slice(1)))
    .join('');

/** Mascota -> mascota (nombre de campo para una asociacion) */
const aCampo = (label: string): string => label.charAt(0).toLowerCase() + label.slice(1);

export function construirModeloJava(nodes: NodeType[], edges: EdgeType[]): ModeloJava {
  const esquema = mapearARelacional(nodes, edges);
  const advertencias: string[] = [];

  // Indice de tabla (snake) -> clase UML, para resolver el destino de las foraneas.
  const porTabla = new Map<string, NodeType>();
  for (const n of nodes) porTabla.set(aSnake(n.label), n);

  const entidades: EntidadJava[] = [];

  for (const tabla of esquema.tablas) {
    const nodo = porTabla.get(tabla.nombre);

    if (!nodo) {
      // Tabla intermedia generada por la regla R5: una relacion muchos a muchos
      // declarada directamente entre dos clases, sin clase asociativa. Tiene
      // clave primaria compuesta y no corresponde a ninguna clase del diagrama,
      // asi que no se puede generar como entidad simple.
      advertencias.push(
        `La relacion "${tabla.proveniencia}" necesita una clase asociativa para poder ` +
          'generarse. Usa "Modelar → Relacion muchos a muchos", que la crea automaticamente, ' +
          'y volve a generar el backend.'
      );
      continue;
    }

    const campos: CampoJava[] = [];

    for (const col of tabla.columnas) {
      if (col.pk && col.nombre === 'id') {
        campos.push({
          clase: 'id',
          javaName: 'id',
          javaType: 'Long',
          columna: 'id',
          nulo: false,
          unica: true,
        });
        continue;
      }

      if (col.fk) {
        const destino = porTabla.get(col.fk.tabla);
        if (!destino) {
          advertencias.push(
            `${nodo.label}: la clave foranea ${col.nombre} apunta a la tabla ${col.fk.tabla}, ` +
              'que no corresponde a ninguna clase del diagrama; se omitio.'
          );
          continue;
        }
        campos.push({
          clase: 'fk',
          // El campo Java es la entidad, no el identificador: asi la asociacion
          // es una asociacion JPA de verdad y la clave foranea existe en la base.
          javaName: aCampo(destino.label),
          javaType: destino.label,
          columna: col.nombre,
          targetEntity: destino.label,
          onDelete: col.fk.onDelete,
          nulo: col.nulo,
          unica: col.unica,
        });
        continue;
      }

      campos.push({
        clase: 'basic',
        javaName: aCamel(col.nombre),
        javaType: tipoJava(col.tipoSql),
        columna: col.nombre,
        nulo: col.nulo,
        unica: col.unica,
      });
    }

    // Si por la forma del diagrama una tabla quedara sin clave primaria, se
    // agrega: una entidad JPA sin @Id no arranca.
    if (!campos.some(c => c.clase === 'id')) {
      campos.unshift({
        clase: 'id',
        javaName: 'id',
        javaType: 'Long',
        columna: 'id',
        nulo: false,
        unica: true,
      });
    }

    entidades.push({ label: nodo.label, tabla: tabla.nombre, campos });
  }

  return { entidades, advertencias };
}

/** Valor de ejemplo para el cuerpo de una peticion de prueba. */
export function valorEjemplo(campo: CampoJava): unknown {
  if (campo.clase === 'fk') return { id: 1 };
  switch (campo.javaType) {
    case 'Integer':
      return 1;
    case 'Long':
      return 1;
    case 'Double':
      return 10.5;
    case 'Boolean':
      return true;
    case 'LocalDate':
      return '2026-01-15';
    case 'LocalDateTime':
      return '2026-01-15T10:30:00';
    default:
      return `texto de ejemplo`;
  }
}
