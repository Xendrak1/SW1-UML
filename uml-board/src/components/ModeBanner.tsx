import React from 'react';

/**
 * Aviso del modo activo (crear relación, muchos a muchos).
 *
 * Antes era un bloque fijo dentro de la barra que estaba siempre ocupando lugar.
 * Ahora aparece flotando sobre el lienzo solo cuando hay un modo activo, que es
 * justo cuando el usuario necesita saber qué se espera de él.
 */

interface ModeBannerProps {
  texto: string;
  onCancel: () => void;
}

const ModeBanner: React.FC<ModeBannerProps> = ({ texto, onCancel }) => (
  <div className='mode-banner' data-toolbar='true' role='status'>
    <span>{texto}</span>
    <button className='btn btn--sm btn--ghost btn--danger' onClick={onCancel}>
      Cancelar
    </button>
  </div>
);

export default ModeBanner;
