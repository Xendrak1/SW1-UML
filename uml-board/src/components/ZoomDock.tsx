import React from 'react';

/**
 * Control de zoom flotante sobre el lienzo.
 *
 * Estaba en la barra superior ocupando cinco botones. Acá abajo a la derecha
 * queda cerca de donde está la mano y libera la barra, que es el espacio escaso.
 */

interface ZoomDockProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onFitAll: () => void;
}

const ZoomDock: React.FC<ZoomDockProps> = ({ zoom, onZoomIn, onZoomOut, onReset, onFitAll }) => (
  <div className='dock dock--br' data-toolbar='true'>
    <button className='btn btn--ghost btn--icon' onClick={onZoomOut} title='Alejar' aria-label='Alejar'>
      −
    </button>
    <button
      className='btn btn--ghost'
      onClick={onReset}
      title='Volver al 100 %'
      style={{ padding: '0 4px' }}
    >
      <span className='dock__value'>{Math.round(zoom * 100)}%</span>
    </button>
    <button className='btn btn--ghost btn--icon' onClick={onZoomIn} title='Acercar' aria-label='Acercar'>
      +
    </button>
    <div className='toolbar__sep' />
    <button
      className='btn btn--ghost btn--icon'
      onClick={onFitAll}
      title='Ajustar todo a la pantalla'
      aria-label='Ajustar todo'
    >
      ⤢
    </button>
  </div>
);

export default ZoomDock;
