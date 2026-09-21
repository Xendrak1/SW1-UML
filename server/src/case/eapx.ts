import MDBReader from 'mdb-reader';

/**
 * LECTOR DE ARCHIVOS .eapx DE ENTERPRISE ARCHITECT
 *
 * Un .eapx es una base de datos Access con el esquema propio de EA: unas 90
 * tablas, de las que aca interesan cinco.
 *
 *   t_diagram         los diagramas (Diagram_Type "Logical" es el de clases)
 *   t_diagramobjects  que elemento esta en que diagrama, y en que posicion
 *   t_object          los elementos (Object_Type "Class", "Actor", "UseCase"...)
 *   t_attribute       los atributos de cada clase
 *   t_connector       las relaciones, con sus cardinalidades y su agregacion
 *
 * Por que en el servidor y no en el navegador: hay que leer un archivo Access
 * binario, y ademas asi el navegador no tiene que cargar el parser.
 *
 * La salida NO es el modelo final: es el mismo JSON que produce el script de
 * exportacion de EA, para que la traduccion de la semantica de EA al modelo
 * propio viva en un solo lugar (uml-board/src/utils/enterpriseArchitect.ts) y no
 * pueda divergir entre los dos caminos de importacion.
 */

export interface ClaseEa {
  id: string;
  guid: string;
  nombre: string;
  estereotipo: string;
  x: number;
  y: number;
  atributos: Array<{ nombre: string; tipo: string; visibilidad: string }>;
}

export interface ConectorEa {
  guid: string;
  tipo: string;
  origen: string;
  destino: string;
  cardOrigen: string;
  cardDestino: string;
  aggOrigen: number;
  aggDestino: number;
}

export interface DiagramaEa {
  id: string;
  nombre: string;
  /** Tipo de EA: Logical, Use Case, Sequence, Package... */
  tipo: string;
  /** Ruta del paquete que lo contiene, para poder distinguir homonimos. */
  paquete: string;
  clases: ClaseEa[];
  conectores: ConectorEa[];
}

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const entero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Diagramas de EA que contienen clases y por lo tanto se pueden importar. */
const TIPOS_CON_CLASES = ['Logical', 'Class', 'Component', 'Deployment'];

export function leerEapx(buffer: Buffer): { diagramas: DiagramaEa[]; total: number } {
  let reader: MDBReader;
  try {
    reader = new MDBReader(buffer);
  } catch (err) {
    throw new Error(
      'No se pudo leer el archivo: no parece un .eapx/.eap de Enterprise Architect ' +
        `(${err instanceof Error ? err.message : err})`
    );
  }

  const tablas = new Set(reader.getTableNames());
  for (const t of ['t_object', 't_diagram', 't_diagramobjects']) {
    if (!tablas.has(t)) {
      throw new Error(
        `El archivo es una base de datos Access pero no tiene la tabla "${t}": ` +
          'no es un proyecto de Enterprise Architect.'
      );
    }
  }

  const filas = (t: string): Array<Record<string, unknown>> =>
    tablas.has(t) ? (reader.getTable(t).getData() as Array<Record<string, unknown>>) : [];

  const objetos = filas('t_object');
  const diagramas = filas('t_diagram');
  const enDiagrama = filas('t_diagramobjects');
  const atributos = filas('t_attribute');
  const conectores = filas('t_connector');
  const paquetes = filas('t_package');

  // ---- ruta de cada paquete, para mostrarla en el selector ----
  const paquetePorId = new Map<string, Record<string, unknown>>();
  for (const p of paquetes) paquetePorId.set(texto(p.Package_ID), p);
  const rutaPaquete = (id: string): string => {
    const partes: string[] = [];
    let actual = paquetePorId.get(id);
    // El tope de vueltas evita un cuelgue si el archivo trae un ciclo.
    for (let i = 0; i < 20 && actual; i += 1) {
      const nombre = texto(actual.Name);
      const padre = texto(actual.Parent_ID);
      if (padre === '0') break; // "Model", la raiz: no aporta al nombre
      partes.push(nombre);
      actual = paquetePorId.get(padre);
    }
    return partes.reverse().join(' / ');
  };

  // ---- indices ----
  const claseporId = new Map<string, Record<string, unknown>>();
  for (const o of objetos) {
    if (texto(o.Object_Type) === 'Class') claseporId.set(texto(o.Object_ID), o);
  }

  const attrsPorObjeto = new Map<string, Array<Record<string, unknown>>>();
  for (const a of atributos) {
    const k = texto(a.Object_ID);
    if (!attrsPorObjeto.has(k)) attrsPorObjeto.set(k, []);
    attrsPorObjeto.get(k)!.push(a);
  }
  for (const lista of attrsPorObjeto.values()) {
    lista.sort((x, y) => entero(x.Pos) - entero(y.Pos));
  }

  const objetosPorDiagrama = new Map<string, Array<Record<string, unknown>>>();
  for (const r of enDiagrama) {
    const k = texto(r.Diagram_ID);
    if (!objetosPorDiagrama.has(k)) objetosPorDiagrama.set(k, []);
    objetosPorDiagrama.get(k)!.push(r);
  }

  const salida: DiagramaEa[] = [];

  for (const d of diagramas) {
    const tipo = texto(d.Diagram_Type);
    if (!TIPOS_CON_CLASES.includes(tipo)) continue;

    const idDiagrama = texto(d.Diagram_ID);
    const puestos = objetosPorDiagrama.get(idDiagrama) ?? [];

    const clases: ClaseEa[] = [];
    const ids = new Set<string>();
    for (const r of puestos) {
      const idObjeto = texto(r.Object_ID);
      const o = claseporId.get(idObjeto);
      if (!o) continue; // actores, notas, fronteras: no son parte del modelo de clases
      ids.add(idObjeto);
      clases.push({
        id: idObjeto,
        guid: texto(o.ea_guid),
        nombre: texto(o.Name),
        estereotipo: texto(o.Stereotype),
        // En EA el eje Y crece hacia arriba y RectTop es negativo.
        x: entero(r.RectLeft),
        y: -entero(r.RectTop),
        atributos: (attrsPorObjeto.get(idObjeto) ?? []).map(a => ({
          nombre: texto(a.Name),
          tipo: texto(a.Type),
          visibilidad: texto(a.Scope),
        })),
      });
    }

    if (clases.length === 0) continue;

    const rels: ConectorEa[] = [];
    for (const c of conectores) {
      const origen = texto(c.Start_Object_ID);
      const destino = texto(c.End_Object_ID);
      // Solo las relaciones cuyos dos extremos estan en este diagrama.
      if (!ids.has(origen) || !ids.has(destino)) continue;
      rels.push({
        guid: texto(c.ea_guid),
        tipo: texto(c.Connector_Type),
        origen,
        destino,
        cardOrigen: texto(c.SourceCard),
        cardDestino: texto(c.DestCard),
        aggOrigen: entero(c.SourceIsAggregate),
        aggDestino: entero(c.DestIsAggregate),
      });
    }

    salida.push({
      id: idDiagrama,
      nombre: texto(d.Name) || `Diagrama ${idDiagrama}`,
      tipo,
      paquete: rutaPaquete(texto(d.Package_ID)),
      clases,
      conectores: rels,
    });
  }

  // El diagrama con mas clases primero: casi siempre es el modelo que se busca.
  salida.sort((a, b) => b.clases.length - a.clases.length);

  if (salida.length === 0) {
    throw new Error(
      'El proyecto de Enterprise Architect no tiene ningun diagrama de clases con clases dentro.'
    );
  }

  return { diagramas: salida, total: salida.length };
}
