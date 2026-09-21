import React, { useState } from 'react';
import type { NodeType } from '../utils/umlConstants';
import { NODE_WIDTH, NODE_HEIGHT, ATTR_HEIGHT } from '../utils/umlConstants';

interface CurrentMultiplicity {
  source: string;
  target: string;
}

declare global {
  interface Window {
    currentMultiplicity?: CurrentMultiplicity;
  }
}

type Props = {
  node: NodeType;
  onMouseDown: (e: React.MouseEvent, node: NodeType) => void;
  addAttribute: (id: string) => void;
  onStartRelation: (id: string, type: string) => void;
  relationMode: boolean;
  isRelationOrigin: boolean;
  onSelectAsTarget: (id: string) => void;
  onClick?: () => void;
  onEditLabel: (id: string, newLabel: string) => void;
  onEditAttribute: (
    nodeId: string,
    attrIdx: number,
    field: 'name' | 'scope' | 'datatype',
    newValue: string
  ) => void;
  onDeleteAttribute: (nodeId: string, attrIdx: number) => void;
  onDeleteNode?: (id: string) => void;
};

const nodeStyle = (n: NodeType, relationMode: boolean): React.CSSProperties => ({
  position: 'absolute',
  left: n.x,
  top: n.y,
  width: NODE_WIDTH,
  height: n.height ?? NODE_HEIGHT,
  border: '1.5px solid var(--node-border)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  cursor: relationMode ? 'pointer' : 'move',
  // En modo relación la clase se resalta, para que se vea que es seleccionable.
  background: relationMode ? 'var(--accent-soft)' : 'var(--node-bg)',
  color: 'var(--text)',
  boxShadow: 'var(--shadow-1)',
  boxSizing: 'border-box',
  borderRadius: 'var(--radius)',
  overflow: 'hidden',
});

// Los campos de la clase son editables en el lugar: sin borde ni fondo, para que
// se lean como texto del diagrama y no como un formulario.
const selectStyle: React.CSSProperties = {
  fontSize: 13,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-2)',
  fontFamily: 'inherit',
  outline: 'none',
  padding: '2px 6px',
  marginRight: 4,
  minWidth: 28,
  maxWidth: 80,
  height: 24,
  boxShadow: 'none',
  appearance: 'none',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
  width: 84,
  marginRight: 4,
  outline: 'none',
};

const RELATION_TYPES = [
  { label: 'Asociación', value: 'asociacion' },
  { label: 'Agregación', value: 'agregacion' },
  { label: 'Composición', value: 'composicion' },
  { label: 'Herencia', value: 'herencia' },
  { label: 'Dependencia', value: 'dependencia' }, // <-- nuevo tipo
];

const Node: React.FC<Props> = ({
  node,
  onMouseDown,
  addAttribute,
  onStartRelation,
  relationMode,
  isRelationOrigin,
  onSelectAsTarget,
  onClick,
  onEditLabel,
  onEditAttribute,
  onDeleteAttribute,
  onDeleteNode,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showMultiplicityMenu, setShowMultiplicityMenu] = useState(false);
  const [selectedRelationType, setSelectedRelationType] = useState<string | null>(null);
  const [hoveredAttr, setHoveredAttr] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={nodeStyle(node, relationMode)}
      onMouseDown={e => {
        if (!relationMode) {
          onMouseDown(e, node);
        }
      }}
      onClick={() => {
        if (relationMode && !isRelationOrigin) onSelectAsTarget(node.id);
        if (onClick) onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        // Cerrar menús al salir del hover
        setShowMenu(false);
        setShowMultiplicityMenu(false);
      }}
    >
      {/* Botón eliminar clase */}
      {hovered && onDeleteNode && (
        <button
          onClick={e => {
            e.stopPropagation();
            onDeleteNode(node.id);
          }}
          title='Eliminar clase'
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            border: 'none',
            background: 'var(--surface)',
            color: 'var(--danger)',
            fontSize: 16,
            cursor: 'pointer',
            borderRadius: '50%',
            boxShadow: 'var(--shadow-1)',
            opacity: 0.85,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            zIndex: 10,
          }}
        >
          ✕
        </button>
      )}
      {/* Compartimento del nombre. En UML va separado del de atributos por una
          línea; además de ser lo correcto, ayuda a leer la clase de un vistazo. */}
      <div
        style={{
          width: '100%',
          textAlign: 'center',
          padding: '7px 0 6px',
          background: 'var(--node-header)',
          borderBottom: '1.5px solid var(--node-border)',
        }}
      >
        <input
          type='text'
          value={node.label}
          onChange={e => onEditLabel(node.id, e.target.value)}
          style={{
            width: '94%',
            fontWeight: 600,
            fontSize: 15,
            textAlign: 'center',
            border: 'none',
            background: 'transparent',
            outline: 'none',
            color: 'var(--text)',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div style={{ width: '100%', maxHeight: '70%', overflowY: 'auto', marginTop: 6 }}>
        {(node.attributes ?? []).map((attr, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              marginBottom: 2,
              width: '100%',
              minHeight: ATTR_HEIGHT,
              boxSizing: 'border-box',
              position: 'relative',
            }}
            onMouseEnter={() => setHoveredAttr(idx)}
            onMouseLeave={() => setHoveredAttr(null)}
          >
            <select
              value={attr.scope}
              onChange={e => onEditAttribute(node.id, idx, 'scope', e.target.value)}
              style={selectStyle}
            >
              <option value='public'>+</option>
              <option value='protected'>#</option>
              <option value='private'>-</option>
            </select>
            <input
              type='text'
              value={attr.name}
              onChange={e => onEditAttribute(node.id, idx, 'name', e.target.value)}
              style={inputStyle}
            />
            <select
              value={attr.datatype}
              onChange={e => onEditAttribute(node.id, idx, 'datatype', e.target.value)}
              style={{ ...selectStyle, marginLeft: 4, maxWidth: 90 }}
            >
              <option value='Integer'>Integer</option>
              <option value='Float'>Float</option>
              <option value='Boolean'>Boolean</option>
              <option value='Date'>Date</option>
              <option value='String'>String</option>
            </select>
            {hoveredAttr === idx && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onDeleteAttribute(node.id, idx);
                }}
                title='Eliminar atributo'
                style={{
                  position: 'absolute',
                  right: 2,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--danger)',
                  fontSize: 16,
                  cursor: 'pointer',
                  opacity: 0.8,
                  transition: 'opacity 0.2s',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {/* Botón agregar atributo - solo visible en hover */}
      {hovered && (
        <button
          onClick={e => {
            e.stopPropagation();
            addAttribute(node.id);
          }}
          title='Agregar atributo'
          style={{
            position: 'absolute',
            bottom: 8,
            right: 40,
            width: 24,
            height: 24,
            border: 'none',
            background: 'var(--surface)',
            color: 'var(--text-2)',
            fontSize: 14,
            cursor: 'pointer',
            borderRadius: '50%',
            boxShadow: 'var(--shadow-1)',
            opacity: 0.85,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.background = 'var(--surface-3)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = '0.85';
            e.currentTarget.style.background = 'var(--surface)';
          }}
        >
          +
        </button>
      )}

      {/* Botón crear relación - solo visible en hover */}
      {hovered && (
        <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 1000 }}>
          <button
            onClick={e => {
              e.stopPropagation();
              setShowMenu(v => !v);
            }}
            title='Crear relación'
            style={{
              width: 24,
              height: 24,
              border: 'none',
              background: 'var(--surface)',
              color: 'var(--text-2)',
              fontSize: 14,
              cursor: 'pointer',
              borderRadius: '50%',
              boxShadow: 'var(--shadow-1)',
              opacity: 0.85,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.background = 'var(--surface-3)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.opacity = '0.85';
              e.currentTarget.style.background = 'var(--surface)';
            }}
          >
            ⇄
          </button>
          {showMenu && (
            <div
              style={{
                position: 'fixed', // <-- Cambia a fixed para que no dependa del tamaño de la clase
                left: window.innerWidth > node.x + NODE_WIDTH ? node.x + NODE_WIDTH : node.x,
                top: node.y + (node.height ?? NODE_HEIGHT) - 32,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                zIndex: 2000, // <-- Muy alto para que esté por encima de todo
                boxShadow: 'var(--shadow-2)',
              }}
              onClick={e => e.stopPropagation()}
            >
              {RELATION_TYPES.map(rt => (
                <div
                  key={rt.value}
                  style={{
                    padding: '6px 16px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    borderBottom: '1px solid var(--border)',
                    background: 'inherit',
                  }}
                  onClick={() => {
                    if (rt.value === 'asociacion') {
                      // Para asociación, mostrar menú de multiplicidad
                      setSelectedRelationType(rt.value);
                      setShowMenu(false);
                      setShowMultiplicityMenu(true);
                    } else {
                      // Para otros tipos, crear relación directamente
                      setShowMenu(false);
                      onStartRelation(node.id, rt.value);
                    }
                  }}
                >
                  {rt.label}
                </div>
              ))}
            </div>
          )}

          {/* Menú de multiplicidad (solo para asociaciones) */}
          {showMultiplicityMenu && (
            <div
              style={{
                position: 'fixed',
                left: window.innerWidth > node.x + NODE_WIDTH ? node.x + NODE_WIDTH : node.x,
                top: node.y + (node.height ?? NODE_HEIGHT) - 32,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                zIndex: 2000,
                boxShadow: 'var(--shadow-2)',
              }}
              onClick={e => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '6px 16px',
                  background: 'var(--surface-3)',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '12px',
                  color: 'var(--text-2)',
                  fontWeight: 'bold',
                }}
              >
                Seleccionar multiplicidad:
              </div>
              <div
                style={{
                  padding: '6px 16px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border)',
                  background: 'inherit',
                }}
                onClick={() => {
                  setShowMultiplicityMenu(false);
                  onStartRelation(node.id, selectedRelationType || 'asociacion');
                  // Guardar multiplicidades para uso posterior
                  window.currentMultiplicity = { source: '1', target: '1' };
                }}
              >
                1 : 1 (Uno a Uno)
              </div>
              <div
                style={{
                  padding: '6px 16px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border)',
                  background: 'inherit',
                }}
                onClick={() => {
                  setShowMultiplicityMenu(false);
                  onStartRelation(node.id, selectedRelationType || 'asociacion');
                  // Guardar multiplicidades para uso posterior
                  window.currentMultiplicity = { source: '1', target: '*' };
                }}
              >
                1 : * (Uno a Muchos)
              </div>
              <div
                style={{
                  padding: '6px 16px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  background: 'inherit',
                }}
                onClick={() => {
                  setShowMultiplicityMenu(false);
                  onStartRelation(node.id, selectedRelationType || 'asociacion');
                  // Guardar multiplicidades para uso posterior
                  window.currentMultiplicity = { source: '*', target: '1' };
                }}
              >
                * : 1 (Muchos a Uno)
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Node;
