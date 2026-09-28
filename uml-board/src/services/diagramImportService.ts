import { v4 as uuidv4 } from 'uuid';
import { api } from '../lib/apiClient';
import type { AttributeType, EdgeType, NodeType } from '../utils/umlConstants';
import {
  convertAccionesToUml,
  gridPosition,
  normalizeDatatype,
  normalizeMultiplicity,
  normalizeScope,
  normalizeTipo,
} from './importarCombinado';

export { convertAccionesToUml };

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
  /** Atributos que la foto agrega a clases que YA estaban en el lienzo. */
  atributosNuevos?: Array<{ nodeId: string; attribute: AttributeType }>;
  /** true cuando la foto se comparo con el diagrama actual en vez de transcribirse entera. */
  combinado?: boolean;
  error?: string;
  provider?: string;
  model?: string;
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
  onProgress?: (stage: string) => void,
  /**
   * Lo que ya hay en el lienzo. Si se pasa y no esta vacio, la foto se COMPARA
   * con esto en vez de transcribirse entera: asi la segunda foto del mismo
   * pizarron suma lo que se agrego (un Vendedor, una intermedia Detalle) en vez
   * de duplicar las clases que ya estaban.
   */
  actuales?: NodeType[],
  /** Relaciones ya dibujadas, para no trazar una linea encima de otra. */
  edgesActuales?: EdgeType[]
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

    const combinar = Array.isArray(actuales) && actuales.length > 0;

    onProgress?.(
      combinar ? 'Comparando la foto con el diagrama actual...' : 'Interpretando el diagrama con IA...'
    );
    const result = await api.imageToUml(file, combinar ? actuales : undefined);

    onProgress?.('Convirtiendo al modelo del editor...');

    if (combinar) {
      const acciones = (result as { actions?: unknown }).actions;
      const { nodes, edges, atributosNuevos } = convertAccionesToUml(
        Array.isArray(acciones) ? (acciones as never[]) : [],
        actuales as NodeType[],
        edgesActuales ?? []
      );
      if (nodes.length === 0 && edges.length === 0 && atributosNuevos.length === 0) {
        throw new Error(
          'La foto no agrega nada que no esté ya en el diagrama. Si esperabas cambios, ' +
            'probá con una foto más nítida y de frente.'
        );
      }
      console.log(
        `[import] combinado: ${nodes.length} clases nuevas, ${edges.length} relaciones y ` +
          `${atributosNuevos.length} atributos via ${result.provider} (${result.model})`
      );
      return {
        success: true,
        nodes,
        edges,
        atributosNuevos,
        combinado: true,
        provider: result.provider,
        model: result.model,
      };
    }

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
