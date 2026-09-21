import type { NodeType, EdgeType } from './umlConstants';

export interface DiagramData {
  nodes: NodeType[];
  edges: EdgeType[];
}

export function importFromJSON(jsonString: string): DiagramData {
  try {
    const data = JSON.parse(jsonString);

    // Validar estructura básica
    if (!data.nodes || !Array.isArray(data.nodes)) {
      throw new Error('El JSON debe contener un array de nodes');
    }

    if (!data.edges || !Array.isArray(data.edges)) {
      throw new Error('El JSON debe contener un array de edges');
    }

    return {
      nodes: data.nodes,
      edges: data.edges,
    };
  } catch (error) {
    throw new Error(`Error parsing JSON: ${error}`);
  }
}

export function exportToJSON(nodes: NodeType[], edges: EdgeType[]): string {
  const data: DiagramData = {
    nodes,
    edges,
  };

  return JSON.stringify(data, null, 2);
}
