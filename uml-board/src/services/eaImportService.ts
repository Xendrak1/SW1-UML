import { importarDumpEa } from '../utils/enterpriseArchitect';
import { api } from '../lib/apiClient';
import type { EdgeType, NodeType } from '../utils/umlConstants';

/**
 * Importacion de un proyecto de Enterprise Architect (.eapx / .eap).
 *
 * El archivo se manda tal cual al servidor, que lo lee -es una base de datos
 * Access- y devuelve los diagramas de clases que hay dentro. No hay ningun paso
 * manual en EA: es abrir el archivo.
 *
 * La traduccion de la semantica de EA al modelo propio NO se hace aca: se
 * reusa importarDumpEa, el mismo que usa el camino por script, para que las
 * dos rutas de importacion no puedan divergir. Ese detalle importa porque la
 * direccion de la composicion es distinta en cada herramienta y tener dos
 * copias de esa regla es pedir que una quede mal.
 */

export interface DiagramaDisponible {
  id: string;
  nombre: string;
  tipo: string;
  paquete: string;
  clases: number;
  relaciones: number;
  /** El volcado crudo, listo para importarDumpEa. */
  dump: string;
}

export interface ModeloImportado {
  nodes: NodeType[];
  edges: EdgeType[];
}

/** Sube el .eapx y devuelve los diagramas que se pueden importar. */
export async function leerProyectoEa(archivo: File): Promise<DiagramaDisponible[]> {
  const res = await api.importarEapx(archivo);
  return (res.diagramas ?? []).map(d => ({
    id: d.id,
    nombre: d.nombre,
    tipo: d.tipo,
    paquete: d.paquete,
    clases: d.clases.length,
    relaciones: d.conectores.length,
    dump: JSON.stringify(d),
  }));
}

/** Convierte el diagrama elegido al modelo de la herramienta. */
export function aModelo(diagrama: DiagramaDisponible): ModeloImportado {
  return importarDumpEa(diagrama.dump);
}

/** true si el nombre del archivo es un proyecto de Enterprise Architect. */
export const esArchivoEa = (nombre: string): boolean => /\.(eapx|eap)$/i.test(nombre);
