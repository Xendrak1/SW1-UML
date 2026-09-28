/**
 * La parte pura de la importacion combinada: acciones de la IA -> modelo del editor.
 *
 * Vive aparte de diagramImportService porque ese modulo habla con la API y con
 * la configuracion del navegador, y esto no necesita ninguna de las dos: asi se
 * puede probar de verdad, sin levantar nada.
 */
import { v4 as uuidv4 } from 'uuid';
import type { AttributeType, EdgeType, NodeType } from '../utils/umlConstants';

const VALID_DATATYPES = ['String', 'Integer', 'Float', 'Boolean', 'Date'] as const;
const VALID_TIPOS = ['asociacion', 'agregacion', 'composicion', 'herencia', 'dependencia'] as const;
type Datatype = (typeof VALID_DATATYPES)[number];
type Scope = 'public' | 'private' | 'protected';
type Tipo = (typeof VALID_TIPOS)[number];

export const normalizeDatatype = (raw: string | undefined): Datatype => {
  const value = (raw ?? '').trim().toLowerCase();
  if (['int', 'integer', 'long', 'entero', 'number'].includes(value)) return 'Integer';
  if (['float', 'double', 'decimal', 'real', 'numeric'].includes(value)) return 'Float';
  if (['bool', 'boolean', 'booleano'].includes(value)) return 'Boolean';
  if (['date', 'datetime', 'timestamp', 'fecha'].includes(value)) return 'Date';
  return VALID_DATATYPES.find(t => t.toLowerCase() === value) ?? 'String';
};

export const normalizeScope = (raw: string | undefined): Scope => {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '+' || value === 'public' || value === 'publico') return 'public';
  if (value === '#' || value === 'protected' || value === 'protegido') return 'protected';
  return 'private';
};

export const normalizeTipo = (raw: string | undefined): Tipo => {
  const value = (raw ?? '').trim().toLowerCase();
  const matched = VALID_TIPOS.find(t => t === value);
  if (matched) return matched;
  if (value.includes('heren') || value.includes('inherit') || value.includes('extend')) return 'herencia';
  if (value.includes('compos')) return 'composicion';
  if (value.includes('agreg') || value.includes('aggreg')) return 'agregacion';
  if (value.includes('depend')) return 'dependencia';
  return 'asociacion';
};

export const normalizeMultiplicity = (raw: string | undefined): '1' | '*' => {
  const value = (raw ?? '1').trim().toLowerCase();
  if (value === '*' || value.includes('..') || value === 'n' || value === 'm' || value.includes('muchos'))
    return '*';
  return '1';
};

const GRID_COLUMNS = 4;

export function gridPosition(index: number): { x: number; y: number } {
  return { x: 80 + (index % GRID_COLUMNS) * 320, y: 80 + Math.floor(index / GRID_COLUMNS) * 260 };
}

/** Una accion tal como la devuelve el servidor en modo combinar. */
interface AccionIa {
  type: string;
  target: string;
  data: Record<string, unknown>;
}

/** Lo que el modelo manda como atributo: se normaliza antes de usarse. */
interface AtributoCrudo {
  name?: unknown;
  datatype?: unknown;
  scope?: unknown;
}

const clave = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Convierte las acciones del modo combinar al modelo del editor.
 *
 * Lo que hace distinto a convertAiResultToUml: las referencias a clases que ya
 * existen se resuelven contra los nodos del lienzo y conservan su id real, asi
 * una relacion nueva se engancha a la clase que ya estaba en vez de duplicarla.
 */
export function convertAccionesToUml(
  acciones: AccionIa[],
  actuales: NodeType[],
  /** Relaciones que ya estan dibujadas, para no volver a trazarlas encima. */
  edgesActuales: EdgeType[] = []
): { nodes: NodeType[]; edges: EdgeType[]; atributosNuevos: Array<{ nodeId: string; attribute: AttributeType }> } {
  const porEtiqueta = new Map<string, string>();
  actuales.forEach(n => porEtiqueta.set(clave(n.label), n.id));

  const nodes: NodeType[] = [];
  const edges: EdgeType[] = [];
  const atributosNuevos: Array<{ nodeId: string; attribute: AttributeType }> = [];
  const asociativasPendientes: Array<{ id: string; relaciona: [string, string] }> = [];

  const resolver = (label: unknown): string | undefined =>
    typeof label === 'string' ? porEtiqueta.get(clave(label)) : undefined;

  /**
   * Dos clases unidas son dos clases unidas, sin importar en que orden lo diga
   * el modelo ni con que tipo. Sin esta clave sin orden, una foto que muestra la
   * misma linea desde los dos lados (o que el modelo repite al describir la
   * intermedia) dibujaba tres lineas paralelas entre las mismas dos cajas.
   */
  const par = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const yaUnidas = new Set<string>(edgesActuales.map(e => par(e.source, e.target)));

  /** Registra la relacion si no existe todavia. Devuelve si la agrego. */
  const agregarRelacion = (
    source: string,
    target: string,
    tipo: EdgeType['tipo'],
    origen: '1' | '*',
    destino: '1' | '*'
  ): boolean => {
    if (source === target) return false;
    const k = par(source, target);
    if (yaUnidas.has(k)) return false;
    yaUnidas.add(k);
    edges.push({
      id: `e_${uuidv4()}`,
      source,
      target,
      tipo,
      multiplicidadOrigen: origen,
      multiplicidadDestino: destino,
    });
    return true;
  };

  const atributosDe = (raw: unknown): AttributeType[] =>
    (Array.isArray(raw) ? (raw as AtributoCrudo[]) : [])
      .filter(a => typeof a?.name === 'string' && a.name.trim().toLowerCase() !== 'id')
      .map(a => ({
        name: String(a.name).trim(),
        datatype: normalizeDatatype(a.datatype === undefined ? undefined : String(a.datatype)),
        scope: normalizeScope(a.scope === undefined ? undefined : String(a.scope)),
      }));

  // Primero las clases nuevas, para que las relaciones que las mencionan resuelvan.
  acciones.forEach(a => {
    if (a.type !== 'create' || a.target !== 'class') return;
    const label = String(a.data?.label ?? '').trim();
    if (label === '' || porEtiqueta.has(clave(label))) return; // ya existe: no se duplica
    const id = uuidv4();
    porEtiqueta.set(clave(label), id);
    const { x, y } = gridPosition(actuales.length + nodes.length);
    const nodo: NodeType = {
      id,
      label,
      x,
      y,
      attributes: atributosDe(a.data?.attributes),
      asociativa: a.data?.asociativa === true,
    };
    nodes.push(nodo);
    const rel = a.data?.relaciona;
    if (nodo.asociativa && Array.isArray(rel) && rel.length === 2) {
      asociativasPendientes.push({ id, relaciona: rel as [string, string] });
    }
  });

  // Las intermedias se enganchan recien ahora, porque pueden apuntar tanto a una
  // clase que ya estaba como a otra creada en esta misma foto.
  asociativasPendientes.forEach(({ id, relaciona }) => {
    const nodo = nodes.find(n => n.id === id);
    if (!nodo) return;
    const idA = resolver(relaciona[0]);
    const idB = resolver(relaciona[1]);
    if (idA && idB) nodo.relaciona = [idA, idB];
    else nodo.asociativa = false;
  });

  acciones.forEach(a => {
    if (a.type === 'create' && a.target === 'attribute') {
      const nodeId = resolver(a.data?.classId);
      const nuevo = atributosDe([a.data])[0];
      if (!nodeId || !nuevo) return;
      const yaEstaba = actuales.find(n => n.id === nodeId);
      // Si la clase ya tiene ese atributo, la foto no agrega nada.
      if (yaEstaba?.attributes?.some(at => clave(at.name) === clave(nuevo.name))) return;
      const enNuevas = nodes.find(n => n.id === nodeId);
      if (enNuevas) (enNuevas.attributes ??= []).push(nuevo);
      else atributosNuevos.push({ nodeId, attribute: nuevo });
      return;
    }
    if (a.type === 'create' && a.target === 'edge') {
      const source = resolver(a.data?.sourceLabel);
      const target = resolver(a.data?.targetLabel);
      if (!source || !target) return;
      agregarRelacion(
        source,
        target,
        normalizeTipo(a.data?.tipo as string | undefined),
        normalizeMultiplicity(a.data?.multiplicidadOrigen as string | undefined),
        normalizeMultiplicity(a.data?.multiplicidadDestino as string | undefined)
      );
    }
  });

  // Igual que en la transcripcion: una intermedia sin sus dos aristas no genera
  // la tabla del backend.
  nodes
    .filter(n => n.asociativa && n.relaciona)
    .forEach(n => {
      (n.relaciona as string[]).forEach(otroId => {
        agregarRelacion(otroId, n.id, 'asociacion', '1', '*');
      });
    });

  return { nodes, edges, atributosNuevos };
}
