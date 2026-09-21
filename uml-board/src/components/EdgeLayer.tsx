import React, { useState } from 'react';
import type { NodeType, EdgeType } from '../utils/umlConstants';
import { NODE_WIDTH, NODE_HEIGHT } from '../utils/umlConstants';

function getRectEdgePoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  height: number
) {
  const w = width / 2,
    h = height / 2,
    dx = x2 - x1,
    dy = y2 - y1;
  let t = 1;
  if (dx === 0) t = h / Math.abs(dy);
  else if (dy === 0) t = w / Math.abs(dx);
  else t = Math.min(w / Math.abs(dx), h / Math.abs(dy));
  return { x: x1 + dx * t, y: y1 + dy * t };
}

function getParallelEdgeInfo(edges: EdgeType[]) {
  // Agrupa ignorando la dirección (A<->B)
  const edgeGroups: Record<string, EdgeType[]> = {};
  edges.forEach(edge => {
    const key = [edge.source, edge.target].sort().join('->');
    if (!edgeGroups[key]) edgeGroups[key] = [];
    edgeGroups[key].push(edge);
  });
  const edgeIndexMap: Record<string, { index: number; total: number; reverse: boolean }> = {};
  Object.keys(edgeGroups).forEach(key => {
    const group = edgeGroups[key];
    group.forEach((edge, idx) => {
      // reverse: si la dirección es opuesta a la clave ordenada
      const [a] = key.split('->');
      const reverse = edge.source !== a;
      edgeIndexMap[edge.id] = { index: idx, total: group.length, reverse };
    });
  });
  return edgeIndexMap;
}

type Props = {
  nodes: NodeType[];
  edges: EdgeType[];
  onDeleteEdge?: (edgeId: string) => void;
};

/**
 * Etiqueta de multiplicidad.
 *
 * Se dibujaba como texto suelto sobre la propia línea, así que en una relación
 * vertical quedaba tapada por ella. Acá se desplaza perpendicularmente a la línea
 * y se le pone un fondo, de modo que se lee en cualquier orientación y sobre
 * cualquier tema.
 */
const MultiplicityLabel: React.FC<{
  /** Extremos de la línea, para calcular la perpendicular. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Posición a lo largo de la línea, de 0 a 1. */
  t: number;
  texto: string;
}> = ({ x1, y1, x2, y2, t, texto }) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const largo = Math.hypot(dx, dy) || 1;
  // Normal unitaria a la línea.
  const nx = -dy / largo;
  const ny = dx / largo;
  const sep = 11;

  const cx = x1 + dx * t + nx * sep;
  const cy = y1 + dy * t + ny * sep;
  const ancho = Math.max(14, texto.length * 8 + 6);

  return (
    <g pointerEvents='none'>
      <rect
        x={cx - ancho / 2}
        y={cy - 9}
        width={ancho}
        height={18}
        rx={4}
        fill='var(--edge-label-bg)'
        stroke='var(--border)'
      />
      <text
        x={cx}
        y={cy}
        fontSize={12}
        fontWeight={600}
        fill='var(--text-2)'
        textAnchor='middle'
        dominantBaseline='central'
      >
        {texto}
      </text>
    </g>
  );
};

const EdgeLayer: React.FC<Props> = ({ nodes, edges, onDeleteEdge }) => {
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const edgeIndexMap = getParallelEdgeInfo(edges);

  // 🔧 Calcular dimensiones dinámicas del diagrama completo
  const calculateDiagramBounds = () => {
    if (nodes.length === 0) {
      return { minX: 0, minY: 0, maxX: window.innerWidth, maxY: window.innerHeight };
    }

    const padding = 200; // Margen extra para evitar cortes
    const minX = Math.min(...nodes.map(n => n.x)) - padding;
    const maxX = Math.max(...nodes.map(n => n.x + NODE_WIDTH)) + padding;
    const minY = Math.min(...nodes.map(n => n.y)) - padding;
    const maxY = Math.max(...nodes.map(n => n.y + (n.height || NODE_HEIGHT))) + padding;

    return {
      minX: Math.min(minX, 0),
      minY: Math.min(minY, 0),
      maxX: Math.max(maxX, window.innerWidth),
      maxY: Math.max(maxY, window.innerHeight),
    };
  };

  const bounds = calculateDiagramBounds();
  const svgWidth = bounds.maxX - bounds.minX;
  const svgHeight = bounds.maxY - bounds.minY;

  return (
    <svg
      style={{
        position: 'absolute',
        left: bounds.minX,
        top: bounds.minY,
        width: svgWidth,
        height: svgHeight,
        // Elimina pointerEvents: 'none' aquí
      }}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      preserveAspectRatio='xMidYMid meet'
    >
      {edges
        .filter(edge => {
          // Si el destino es una tabla asociativa, y esa tabla tiene relaciona, omite la línea normal
          const tgtNode = nodes.find(n => n.id === edge.target);
          if (tgtNode?.asociativa && tgtNode.relaciona) {
            // Si el edge conecta a una tabla asociativa y su origen está en relaciona, omite
            return !tgtNode.relaciona.includes(edge.source);
          }
          // Si el origen es una tabla asociativa, y esa tabla tiene relaciona, omite la línea normal
          const srcNode = nodes.find(n => n.id === edge.source);
          if (srcNode?.asociativa && srcNode.relaciona) {
            return !srcNode.relaciona.includes(edge.target);
          }
          return true;
        })
        .map(edge => {
          const src = nodes.find(n => n.id === edge.source);
          const tgt = nodes.find(n => n.id === edge.target);
          if (!src || !tgt) return null;

          const srcHeight = src.height ?? NODE_HEIGHT;
          const tgtHeight = tgt.height ?? NODE_HEIGHT;
          const info = edgeIndexMap[edge.id] || { index: 0, total: 1, reverse: false };
          let offset = 0;
          if (info.total > 1) {
            const separation = 18;
            offset = (info.index - (info.total - 1) / 2) * separation;
            if (info.reverse) offset = -offset; // Invierte para la dirección opuesta
          }

          // 🔧 Ajustar coordenadas al sistema SVG (restar el offset del bounds)
          const x1c = src.x + NODE_WIDTH / 2 - bounds.minX;
          const y1c = src.y + srcHeight / 2 - bounds.minY;
          const x2c = tgt.x + NODE_WIDTH / 2 - bounds.minX;
          const y2c = tgt.y + tgtHeight / 2 - bounds.minY;

          const dx = x2c - x1c,
            dy = y2c - y1c,
            len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len,
            ny = dx / len;
          const x1c_off = x1c + nx * offset,
            y1c_off = y1c + ny * offset;
          const x2c_off = x2c + nx * offset,
            y2c_off = y2c + ny * offset;
          const { x: x1, y: y1 } = getRectEdgePoint(
            x1c_off,
            y1c_off,
            x2c_off,
            y2c_off,
            NODE_WIDTH,
            srcHeight
          );
          const { x: x2, y: y2 } = getRectEdgePoint(
            x2c_off,
            y2c_off,
            x1c_off,
            y1c_off,
            NODE_WIDTH,
            tgtHeight
          );

          // Dibuja según el tipo UML
          switch (edge.tipo) {
            case 'agregacion':
              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ pointerEvents: 'all' }}
                >
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke='var(--edge)' strokeWidth={2} />
                  <polygon
                    points={getDiamondPoints(x1, y1, x2, y2, 14)}
                    fill='var(--edge-label-bg)'
                    stroke='var(--edge)'
                    strokeWidth={2}
                  />
                  {/* La agregacion y la composicion tambien llevan multiplicidades en UML */}
                  <MultiplicityLabel
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    t={0.2}
                    texto={edge.multiplicidadOrigen}
                  />
                  <MultiplicityLabel
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    t={0.8}
                    texto={edge.multiplicidadDestino}
                  />
                  {hoveredEdge === edge.id && onDeleteEdge && (
                    <foreignObject
                      x={(x1 + x2) / 2 - 12}
                      y={(y1 + y2) / 2 - 12}
                      width={24}
                      height={24}
                      style={{ pointerEvents: 'all' }}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteEdge(edge.id);
                        }}
                        title='Eliminar relación'
                        style={{
                          width: 24,
                          height: 24,
                          border: 'none',
                          background: 'var(--edge-label-bg)',
                          color: 'var(--danger)',
                          fontSize: 16,
                          cursor: 'pointer',
                          borderRadius: '50%',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                          opacity: 0.85,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </foreignObject>
                  )}
                </g>
              );
            case 'composicion':
              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ pointerEvents: 'all' }}
                >
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke='var(--edge)' strokeWidth={2} />
                  <polygon
                    points={getDiamondPoints(x1, y1, x2, y2, 14)}
                    fill='var(--edge)'
                    stroke='var(--edge)'
                    strokeWidth={2}
                  />
                  {/* La agregacion y la composicion tambien llevan multiplicidades en UML */}
                  <MultiplicityLabel
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    t={0.2}
                    texto={edge.multiplicidadOrigen}
                  />
                  <MultiplicityLabel
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    t={0.8}
                    texto={edge.multiplicidadDestino}
                  />
                  {hoveredEdge === edge.id && onDeleteEdge && (
                    <foreignObject
                      x={(x1 + x2) / 2 - 12}
                      y={(y1 + y2) / 2 - 12}
                      width={24}
                      height={24}
                      style={{ pointerEvents: 'all' }}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteEdge(edge.id);
                        }}
                        title='Eliminar relación'
                        style={{
                          width: 24,
                          height: 24,
                          border: 'none',
                          background: 'var(--edge-label-bg)',
                          color: 'var(--danger)',
                          fontSize: 16,
                          cursor: 'pointer',
                          borderRadius: '50%',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                          opacity: 0.85,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </foreignObject>
                  )}
                </g>
              );
            case 'dependencia':
              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ pointerEvents: 'all' }}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={getArrowBase(x1, y1, x2, y2, 18).x}
                    y2={getArrowBase(x1, y1, x2, y2, 18).y}
                    stroke='var(--edge)'
                    strokeWidth={2}
                    strokeDasharray='6 4'
                  />
                  <polyline
                    points={getOpenArrowPoints(x2, y2, x1, y1, 18)}
                    fill='none'
                    stroke='var(--edge)'
                    strokeWidth={2}
                  />
                  {hoveredEdge === edge.id && onDeleteEdge && (
                    <foreignObject
                      x={(x1 + x2) / 2 - 12}
                      y={(y1 + y2) / 2 - 12}
                      width={24}
                      height={24}
                      style={{ pointerEvents: 'all' }}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteEdge(edge.id);
                        }}
                        title='Eliminar relación'
                        style={{
                          width: 24,
                          height: 24,
                          border: 'none',
                          background: 'var(--edge-label-bg)',
                          color: 'var(--danger)',
                          fontSize: 16,
                          cursor: 'pointer',
                          borderRadius: '50%',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                          opacity: 0.85,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </foreignObject>
                  )}
                </g>
              );
            case 'herencia':
              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ pointerEvents: 'all' }}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={getArrowBase(x1, y1, x2, y2, 18).x}
                    y2={getArrowBase(x1, y1, x2, y2, 18).y}
                    stroke='var(--edge)'
                    strokeWidth={2}
                  />
                  {/* Triángulo blanco en el destino */}
                  <polygon
                    points={getTrianglePoints(x2, y2, x1, y1, 18)}
                    fill='var(--edge-label-bg)'
                    stroke='var(--edge)'
                    strokeWidth={2}
                  />
                  {hoveredEdge === edge.id && onDeleteEdge && (
                    <foreignObject
                      x={(x1 + x2) / 2 - 12}
                      y={(y1 + y2) / 2 - 12}
                      width={24}
                      height={24}
                      style={{ pointerEvents: 'all' }}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteEdge(edge.id);
                        }}
                        title='Eliminar relación'
                        style={{
                          width: 24,
                          height: 24,
                          border: 'none',
                          background: 'var(--edge-label-bg)',
                          color: 'var(--danger)',
                          fontSize: 16,
                          cursor: 'pointer',
                          borderRadius: '50%',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                          opacity: 0.85,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </foreignObject>
                  )}
                </g>
              );
            default: // asociacion
              return (
                <g
                  key={edge.id}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  style={{ pointerEvents: 'all' }} // <-- Permite eventos en el grupo
                >
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke='var(--edge)' strokeWidth={2} />
                  <MultiplicityLabel
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    t={0.12}
                    texto={edge.multiplicidadOrigen}
                  />
                  <MultiplicityLabel
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    t={0.88}
                    texto={edge.multiplicidadDestino}
                  />
                  {/* Botón eliminar solo en hover */}
                  {hoveredEdge === edge.id && onDeleteEdge && (
                    <foreignObject
                      x={(x1 + x2) / 2 - 12}
                      y={(y1 + y2) / 2 - 12}
                      width={24}
                      height={24}
                      style={{ pointerEvents: 'all' }}
                    >
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteEdge(edge.id);
                        }}
                        title='Eliminar relación'
                        style={{
                          width: 24,
                          height: 24,
                          border: 'none',
                          background: 'var(--edge-label-bg)',
                          color: 'var(--danger)',
                          fontSize: 16,
                          cursor: 'pointer',
                          borderRadius: '50%',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                          opacity: 0.85,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0,
                        }}
                      >
                        ✕
                      </button>
                    </foreignObject>
                  )}
                </g>
              );
          }
        })}

      {/* Renderizado especial para tablas asociativas */}
      {nodes
        .filter(n => n.asociativa && n.relaciona)
        .map(tabla => {
          const [idA, idB] = tabla.relaciona!;
          const nodeA = nodes.find(n => n.id === idA);
          const nodeB = nodes.find(n => n.id === idB);
          if (!nodeA || !nodeB) return null;

          // 🔧 Posiciones centrales ajustadas al sistema SVG
          const ax = nodeA.x + NODE_WIDTH / 2 - bounds.minX;
          const ay = nodeA.y + (nodeA.height ?? NODE_HEIGHT) / 2 - bounds.minY;
          const bx = nodeB.x + NODE_WIDTH / 2 - bounds.minX;
          const by = nodeB.y + (nodeB.height ?? NODE_HEIGHT) / 2 - bounds.minY;
          const tx = tabla.x + NODE_WIDTH / 2 - bounds.minX;
          const ty = tabla.y + (tabla.height ?? NODE_HEIGHT) / 2 - bounds.minY;

          // Offset perpendicular para evitar solapamiento
          const dx = bx - ax,
            dy = by - ay;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const offset = 24; // píxeles de desplazamiento
          const ox = (-dy / len) * offset;
          const oy = (dx / len) * offset;

          // Puntos desplazados
          const ax_off = ax + ox,
            ay_off = ay + oy;
          const bx_off = bx + ox,
            by_off = by + oy;
          const mx = (ax_off + bx_off) / 2;
          const my = (ay_off + by_off) / 2;

          // Multiplicidad
          const edgeA = edges.find(
            e =>
              (e.source === tabla.id && e.target === idA) ||
              (e.target === tabla.id && e.source === idA)
          );
          const edgeB = edges.find(
            e =>
              (e.source === tabla.id && e.target === idB) ||
              (e.target === tabla.id && e.source === idB)
          );

          // ID especial para eliminar la tabla asociativa
          const assocEdgeId = `assoc-${tabla.id}-${idA}-${idB}`;

          return (
            <g key={assocEdgeId} style={{ pointerEvents: 'all' }}>
              {/* Línea principal desplazada entre las dos clases */}
              <line x1={ax_off} y1={ay_off} x2={bx_off} y2={by_off} stroke='var(--text-3)' />
              {/* Multiplicidad en los extremos */}
              <MultiplicityLabel
                x1={ax_off}
                y1={ay_off}
                x2={bx_off}
                y2={by_off}
                t={0.18}
                texto={edgeA?.multiplicidadDestino ?? '*'}
              />
              <MultiplicityLabel
                x1={ax_off}
                y1={ay_off}
                x2={bx_off}
                y2={by_off}
                t={0.82}
                texto={edgeB?.multiplicidadDestino ?? '*'}
              />
              {/* Línea interlineada desde el punto medio a la tabla intermedia */}
              <line x1={mx} y1={my} x2={tx} y2={ty} stroke='var(--edge)' strokeDasharray='4 2' />
              {/* Área invisible para hover y botón eliminar */}
              <rect
                x={mx - 16}
                y={my - 16}
                width={32}
                height={32}
                fill='transparent'
                style={{ pointerEvents: 'all' }}
                onMouseEnter={() => setHoveredEdge(assocEdgeId)}
                onMouseLeave={() => setHoveredEdge(null)}
              />
              {/* Botón eliminar solo en hover */}
              {hoveredEdge === assocEdgeId && onDeleteEdge && (
                <foreignObject
                  x={mx - 12}
                  y={my - 12}
                  width={24}
                  height={24}
                  style={{ pointerEvents: 'all' }}
                >
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onDeleteEdge(assocEdgeId);
                    }}
                    title='Eliminar relación muchos a muchos'
                    style={{
                      width: 24,
                      height: 24,
                      border: 'none',
                      background: 'var(--edge-label-bg)',
                      color: 'var(--danger)',
                      fontSize: 16,
                      cursor: 'pointer',
                      borderRadius: '50%',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
                      opacity: 0.85,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                </foreignObject>
              )}
            </g>
          );
        })}
    </svg>
  );
};

export default EdgeLayer;

// Helpers para polígonos UML:
function getDiamondPoints(x1: number, y1: number, x2: number, y2: number, size: number) {
  // Dibuja un rombo perfecto en el origen (x1, y1)
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len,
    ny = dy / len;
  // Centro del rombo a una distancia 'size' desde el origen
  const p0 = [x1, y1];
  const p1 = [x1 + nx * (size / 2) - ny * (size / 3), y1 + ny * (size / 2) + nx * (size / 3)];
  const p2 = [x1 + nx * size, y1 + ny * size];
  const p3 = [x1 + nx * (size / 2) + ny * (size / 3), y1 + ny * (size / 2) - nx * (size / 3)];
  return [p0, p1, p2, p3].map(p => p.join(',')).join(' ');
}

function getTrianglePoints(x2: number, y2: number, x1: number, y1: number, size: number) {
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len,
    ny = dy / len;
  const px = -ny,
    py = nx;
  // Base del triángulo
  const bx = x2 - nx * size,
    by = y2 - ny * size;
  return [
    [x2, y2],
    [bx + px * size * 0.5, by + py * size * 0.5],
    [bx - px * size * 0.5, by - py * size * 0.5],
  ]
    .map(p => p.join(','))
    .join(' ');
}

function getArrowBase(x1: number, y1: number, x2: number, y2: number, size: number) {
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len,
    ny = dy / len;
  return { x: x2 - nx * size, y: y2 - ny * size };
}

function getOpenArrowPoints(x2: number, y2: number, x1: number, y1: number, size: number) {
  const dx = x2 - x1,
    dy = y2 - y1,
    len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = dx / len,
    ny = dy / len;
  const px = -ny,
    py = nx;
  // Dos líneas formando la flecha abierta
  const bx = x2 - nx * size,
    by = y2 - ny * size;
  return [
    [
      bx + px * size * 0.4,
      by + py * size * 0.4,
      x2,
      y2,
      bx - px * size * 0.4,
      by - py * size * 0.4,
    ],
  ]
    .map(p => `${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}`)
    .join(' ');
}
