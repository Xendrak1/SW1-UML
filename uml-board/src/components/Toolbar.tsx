import React from 'react';
import { Link } from 'react-router-dom';
import { useAiStatus, type Board } from '../hooks/useDiagramSync';
import { ThemeToggle } from '../lib/theme';
import { useClassStore } from '../store/classStore';
import { ADAPTADORES } from '../utils/architech';
import CollabBar from './CollabBar';
import { Menu, MenuDivider, MenuItem, MenuLabel } from './Menu';

/**
 * Barra de herramientas.
 *
 * Criterio de diseño: en la barra quedan solo la identidad del documento, la
 * acción principal (crear clase) y el estado de la sesión. Todo lo demás vive en
 * menús agrupados por intención —modelar, intercambiar, generar, navegar— y el
 * zoom se movió a un control flotante sobre el lienzo (ver ZoomDock).
 */

export interface ToolbarProps {
  // Pizarras
  boards: Board[];
  currentBoardId: string;
  currentBoardName: string;
  onSelectBoard: (id: string) => void;
  onCreateBoard: () => void;
  onRenameBoard: (id: string) => void;
  onDeleteBoard: (id: string) => void;

  // Modelado
  onAddClass: () => void;
  onOpenAssistant: () => void;
  onStartManyToMany: () => void;
  onClearBoard: () => void;

  // Intercambio
  onImportImage: () => void;
  onImportFile: () => void;
  onImportEa: () => void;
  onScriptExportarEa: () => void;
  onExport: () => void;
  formato: string;
  onFormatoChange: (id: string) => void;
  importing: boolean;
  importProgress: string;

  // Generación
  onGenerateBackend: () => void;
  onGenerateFrontend: () => void;

  onCopyUrl: () => void;
}

const Toolbar: React.FC<ToolbarProps> = props => {
  const nodes = useClassStore(s => s.nodes);
  const aiStatus = useAiStatus();

  // Varias acciones no tienen sentido con la pizarra vacía; se muestran deshabilitadas.
  const vacio = nodes.length === 0;

  const iaTexto = !aiStatus
    ? 'IA sin verificar'
    : aiStatus.local.available
      ? 'IA local'
      : aiStatus.cloud.available
        ? 'IA en la nube'
        : 'IA no disponible';

  return (
    <div className='toolbar' data-toolbar='true'>
      <div className='toolbar__brand'>
        <span className='toolbar__mark'>UM</span>
        <span>CASE UML</span>
      </div>

      {/* Documento actual: la pizarra es lo que define el contexto de todo lo demás */}
      <Menu
        label={props.currentBoardName}
        icon='◫'
        title='Pizarra actual'
        minWidth={280}
      >
        {cerrar => (
          <>
            <MenuLabel>Pizarras</MenuLabel>
            {props.boards.map(b => (
              <div className='menu__row' key={b.id}>
                <MenuItem
                  icon={b.id === props.currentBoardId ? '●' : '○'}
                  current={b.id === props.currentBoardId}
                  onClick={() => {
                    props.onSelectBoard(b.id);
                    cerrar();
                  }}
                >
                  {b.name}
                </MenuItem>
                <button
                  className='btn btn--ghost btn--icon btn--sm'
                  title='Renombrar'
                  onClick={() => {
                    props.onRenameBoard(b.id);
                    cerrar();
                  }}
                >
                  ✎
                </button>
                {props.boards.length > 1 && (
                  <button
                    className='btn btn--ghost btn--icon btn--sm btn--danger'
                    title='Eliminar'
                    onClick={() => {
                      props.onDeleteBoard(b.id);
                      cerrar();
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <MenuDivider />
            <MenuItem
              icon='+'
              onClick={() => {
                props.onCreateBoard();
                cerrar();
              }}
            >
              Nueva pizarra
            </MenuItem>
            <MenuItem
              icon='⧉'
              onClick={() => {
                props.onCopyUrl();
                cerrar();
              }}
            >
              Copiar enlace para invitar
            </MenuItem>
          </>
        )}
      </Menu>

      <div className='toolbar__sep' />

      {/* Acción principal: es la que se usa a cada rato, así que va suelta */}
      <button className='btn btn--primary' onClick={props.onAddClass} title='Agregar una clase (N)'>
        <span style={{ fontSize: 15, lineHeight: 1 }}>+</span>
        <span className='btn__label'>Clase</span>
      </button>

      <Menu label='Modelar' icon='◇' title='Herramientas de modelado'>
        {cerrar => (
          <>
            <MenuItem
              icon='✦'
              hint='Ctrl+K'
              onClick={() => {
                props.onOpenAssistant();
                cerrar();
              }}
            >
              Asistente por voz o texto
            </MenuItem>
            <MenuItem
              icon='⇹'
              onClick={() => {
                props.onStartManyToMany();
                cerrar();
              }}
            >
              Relación muchos a muchos
            </MenuItem>
            <MenuDivider />
            <MenuItem
              icon='⌫'
              danger
              disabled={vacio}
              onClick={() => {
                props.onClearBoard();
                cerrar();
              }}
            >
              Vaciar la pizarra
            </MenuItem>
          </>
        )}
      </Menu>

      <Menu label='Intercambio' icon='⇅' title='Importar y exportar' minWidth={290}>
        {cerrar => (
          <>
            <MenuLabel>Importar</MenuLabel>
            <MenuItem
              icon='◳'
              disabled={props.importing}
              onClick={() => {
                props.onImportImage();
                cerrar();
              }}
            >
              {props.importing ? props.importProgress || 'Importando...' : 'Desde una foto'}
            </MenuItem>
            <MenuItem
              icon='⊞'
              onClick={() => {
                props.onImportFile();
                cerrar();
              }}
            >
              Desde un archivo (JSON o XMI)
            </MenuItem>
            <MenuItem
              icon='▣'
              hint='.eapx'
              disabled={props.importing}
              onClick={() => {
                props.onImportEa();
                cerrar();
              }}
            >
              Desde Enterprise Architect
            </MenuItem>
            <MenuItem
              icon='⧉'
              hint='EA 15'
              onClick={() => {
                props.onScriptExportarEa();
                cerrar();
              }}
            >
              Script para exportar desde EA
            </MenuItem>

            <MenuDivider />
            <MenuLabel>Exportar</MenuLabel>
            <div style={{ padding: '2px 6px 6px' }}>
              <select
                className='select'
                style={{ width: '100%' }}
                value={props.formato}
                onChange={e => props.onFormatoChange(e.target.value)}
              >
                {ADAPTADORES.map(a => (
                  <option key={a.id} value={a.id} disabled={!a.disponible}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </div>
            <MenuItem
              icon='↧'
              disabled={vacio}
              onClick={() => {
                props.onExport();
                cerrar();
              }}
            >
              Descargar el diagrama
            </MenuItem>
          </>
        )}
      </Menu>

      <Menu label='Generar' icon='⚙' title='Generación de código' minWidth={250}>
        {cerrar => (
          <>
            <MenuItem
              icon='⬢'
              disabled={vacio}
              onClick={() => {
                props.onGenerateBackend();
                cerrar();
              }}
            >
              Backend Spring Boot
            </MenuItem>
            <MenuItem
              icon='▤'
              disabled={vacio}
              onClick={() => {
                props.onGenerateFrontend();
                cerrar();
              }}
            >
              Frontend de prueba
            </MenuItem>
            <MenuDivider />
            <MenuLabel>Diseño de datos</MenuLabel>
            <Link to='/datos' className='menu__item' onClick={cerrar}>
              <span className='menu__icon'>▦</span>
              <span style={{ flex: 1 }}>Modelo, mapeo y normalización</span>
            </Link>
          </>
        )}
      </Menu>

      <div className='toolbar__spacer' />

      <CollabBar />

      <div className='toolbar__sep' />

      <Menu label='Más' icon='⋯' align='right' title='Otras vistas' minWidth={230}>
        {cerrar => (
          <>
            <Link to='/voz' className='menu__item' onClick={cerrar}>
              <span className='menu__icon'>◍</span>
              <span style={{ flex: 1 }}>Modo voz (móvil)</span>
            </Link>
            <Link to='/guia' className='menu__item' onClick={cerrar}>
              <span className='menu__icon'>?</span>
              <span style={{ flex: 1 }}>Guía de usuario</span>
            </Link>
            <Link to='/debug' className='menu__item' onClick={cerrar}>
              <span className='menu__icon'>⌘</span>
              <span style={{ flex: 1 }}>Diagnóstico</span>
            </Link>
            <MenuDivider />
            <div className='menu__item' style={{ cursor: 'default' }}>
              <span className='menu__icon'>◈</span>
              <span style={{ flex: 1 }} className='muted small'>
                {iaTexto}
              </span>
            </div>
          </>
        )}
      </Menu>

      <ThemeToggle compact />
    </div>
  );
};

export default Toolbar;
