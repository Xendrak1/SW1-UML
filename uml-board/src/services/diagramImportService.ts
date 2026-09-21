import { v4 as uuidv4 } from 'uuid';
import { api } from '../lib/apiClient';
import type { AttributeType, EdgeType, NodeType } from '../utils/umlConstants';

/**
 * Importacion de un diagrama de clases a partir de una foto o captura.
 *
 * La version anterior mandaba la imagen a Supabase Storage y luego a OpenAI desde el
 * navegador, con la clave de API escrita en este archivo. Ahora:
 *  - la imagen va al backend propio, que la analiza con IA local (Ollama vision) o
 *    en la nube segun AI_STRATEGY
 *  - el backend devuelve clases y relaciones ya normalizadas
 *  - aqui solo queda la conversion al modelo del editor y el acomodo en el lienzo
 */

export interface AnalysisResult {
  success: boolean;
  nodes?: NodeType[];
  edges?: EdgeType[];
  error?: string;
  provider?: string;
  model?: string;
}

const VALID_DATATYPES = ['String', 'Integer', 'Float', 'Boolean', 'Date'] as const;
type ScopeLiteral = 'public' | 'private' | 'protected';
const VALID_TIPOS = ['asociacion', 'agregacion', 'composicion', 'herencia', 'dependencia'] as const;

type Datatype = (typeof VALID_DATATYPES)[number];
type Scope = ScopeLiteral;
type Tipo = (typeof VALID_TIPOS)[number];

const normalizeDatatype = (raw: string | undefined): Datatype => {
  const value = (raw ?? '').trim().toLowerCase();
  if (['int', 'integer', 'long', 'entero', 'number'].includes(value)) return 'Integer';
  if (['float', 'double', 'decimal', 'real', 'numeric'].includes(value)) return 'Float';
  if (['bool', 'boolean', 'booleano'].includes(value)) return 'Boolean';
  if (['date', 'datetime', 'timestamp', 'fecha'].includes(value)) return 'Date';
  const matched = VALID_DATATYPES.find(t => t.toLowerCase() === value);
  return matched ?? 'String';
};

const normalizeScope = (raw: string | undefined): Scope => {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '+' || value === 'public' || value === 'publico') return 'public';
  if (value === '#' || value === 'protected' || value === 'protegido') return 'protected';
  return 'private';
};

const normalizeTipo = (raw: string | undefined): Tipo => {
  const value = (raw ?? '').trim().toLowerCase();
  const matched = VALID_TIPOS.find(t => t === value);
  if (matched) return matched;
  if (value.includes('heren') || value.includes('inherit') || value.includes('extend'))
    return 'herencia';
  if (value.includes('compos')) return 'composicion';
  if (value.includes('agreg') || value.includes('aggreg')) return 'agregacion';
  if (value.includes('depend')) return 'dependencia';
  return 'asociacion';
};

/** Cualquier cardinalidad "muchos" (n, m, 0..*, 1..*) se reduce a '*'. */
const normalizeMultiplicity = (raw: string | undefined): '1' | '*' => {
  const value = (raw ?? '1').trim().toLowerCase();
  if (value === '*' || value.includes('..') || value === 'n' || value === 'm' || value.includes('muchos'))
    return '*';
  return '1';
};

/** Acomodo en cuadricula: las clases importadas quedan legibles sin tener que moverlas. */
const GRID_COLUMNS = 4;
const GRID_X = 320;
const GRID_Y = 260;

function gridPosition(index: number): { x: number; y: number } {
  return {
    x: 80 + (index % GRID_COLUMNS) * GRID_X,
    y: 80 + Math.floor(index / GRID_COLUMNS) * GRID_Y,
  };
}

interface AiClass {
  label: string;
  attributes?: Array<{ name: string; datatype?: string; scope?: string }>;
  asociativa?: boolean;
  relaciona?: [string, string];
}

interface AiRelation {
  sourceLabel: string;
  targetLabel: string;
  tipo?: string;
  multiplicidadOrigen?: string;
  multiplicidadDestino?: string;
}

/**
 * Convierte la respuesta de la IA al modelo del editor.
 * Exportada para poder probarla sin llamar a la IA.
 */
export function convertAiResultToUml(
  classes: AiClass[],
  relations: AiRelation[]
): { nodes: NodeType[]; edges: EdgeType[] } {
  const byLabel = new Map<string, string>();

  const nodes: NodeType[] = classes
    .filter(c => typeof c.label === 'string' && c.label.trim() !== '')
    .map((c, index) => {
      const id = uuidv4();
      byLabel.set(c.label.trim().toLowerCase(), id);
      const attributes: AttributeType[] = (c.attributes ?? [])
        // El 'id' es implicito: lo agrega el generador de backend.
        .filter(a => a?.name && a.name.trim().toLowerCase() !== 'id')
        .map(a => ({
          name: a.name.trim(),
          datatype: normalizeDatatype(a.datatype),
          scope: normalizeScope(a.scope),
        }));

      const { x, y } = gridPosition(index);
      return { id, label: c.label.trim(), x, y, attributes, asociativa: c.asociativa ?? false };
    });

  // 'relaciona' viene con nombres de clase; el editor necesita ids.
  const resolve = (label: string | undefined) =>
    label ? byLabel.get(label.trim().toLowerCase()) : undefined;

  classes.forEach(c => {
    if (!c.asociativa || !c.relaciona) return;
    const nodeId = resolve(c.label);
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    const [a, b] = c.relaciona;
    const idA = resolve(a);
    const idB = resolve(b);
    if (idA && idB) node.relaciona = [idA, idB];
    else node.asociativa = false; // sin los dos extremos no es una clase asociativa valida
  });

  const edges: EdgeType[] = [];
  const seen = new Set<string>();

  relations.forEach(rel => {
    const source = resolve(rel.sourceLabel);
    const target = resolve(rel.targetLabel);
    if (!source || !target || source === target) return;

    const tipo = normalizeTipo(rel.tipo);
    // Sin esto, una foto poco clara genera la misma relacion varias veces.
    const key = `${source}|${target}|${tipo}`;
    if (seen.has(key)) return;
    seen.add(key);

    edges.push({
      id: `e_${uuidv4()}`,
      source,
      target,
      tipo,
      multiplicidadOrigen: normalizeMultiplicity(rel.multiplicidadOrigen),
      multiplicidadDestino: normalizeMultiplicity(rel.multiplicidadDestino),
    });
  });

  // Una clase asociativa sin relaciones dibujadas igual necesita sus dos aristas,
  // o el generador de backend no puede crear la tabla intermedia.
  nodes
    .filter(n => n.asociativa && n.relaciona)
    .forEach(n => {
      (n.relaciona as string[]).forEach(otherId => {
        const exists = edges.some(
          e =>
            (e.source === otherId && e.target === n.id) ||
            (e.source === n.id && e.target === otherId)
        );
        if (exists) return;
        edges.push({
          id: `e_${uuidv4()}`,
          source: otherId,
          target: n.id,
          tipo: 'asociacion',
          multiplicidadOrigen: '1',
          multiplicidadDestino: '*',
        });
      });
    });

  return { nodes, edges };
}

/** Importa un diagrama desde una imagen (foto de pizarra, captura, boceto). */
export async function importDiagramFromImage(
  file: File,
  onProgress?: (stage: string) => void
): Promise<AnalysisResult> {
  try {
    if (!file.type.startsWith('image/')) {
      throw new Error('Solo se permiten archivos de imagen');
    }
    if (file.size > 12 * 1024 * 1024) {
      throw new Error('La imagen debe pesar menos de 12 MB');
    }

    // Se guarda en el servidor para dejar constancia de la entrada analizada
    // (util como anexo de la documentacion). Si falla, la importacion sigue.
    onProgress?.('Guardando la imagen en el servidor...');
    try {
      await api.uploadFile(file);
    } catch (err) {
      console.warn('[import] no se pudo archivar la imagen, se continua', err);
    }

    onProgress?.('Interpretando el diagrama con IA...');
    const result = await api.imageToUml(file);

    onProgress?.('Convirtiendo al modelo del editor...');
    const { nodes, edges } = convertAiResultToUml(result.classes ?? [], result.relations ?? []);

    if (nodes.length === 0) {
      throw new Error(
        'No se reconocio ninguna clase en la imagen. Probá con una foto más nítida, ' +
          'de frente y con los nombres legibles.'
      );
    }

    console.log(
      `[import] ${nodes.length} clases y ${edges.length} relaciones via ${result.provider} (${result.model})`
    );

    return { success: true, nodes, edges, provider: result.provider, model: result.model };
  } catch (error) {
    console.error('[import] error', error);
    return { success: false, error: error instanceof Error ? error.message : 'Error desconocido' };
  }
}
