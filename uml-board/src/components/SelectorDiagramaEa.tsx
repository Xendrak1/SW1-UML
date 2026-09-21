import React from 'react';
import type { DiagramaDisponible } from '../services/eaImportService';

/**
 * Un proyecto de Enterprise Architect suele traer varios diagramas de clases
 * (el modelo conceptual, las clases dinamicas de cada caso de uso, el de
 * analisis...). Importar todo junto mezclaria niveles distintos del diseno, y
 * quedarse con el mas grande acierta casi siempre pero no siempre. Asi que
 * cuando hay mas de uno se pregunta, con la ruta del paquete a la vista para
 * poder distinguir los homonimos: en un proyecto real hay varios diagramas que
 * se llaman igual en paquetes distintos.
 */

interface Props {
  archivo: string;
  diagramas: DiagramaDisponible[];
  onElegir: (d: DiagramaDisponible) => void;
  onCancelar: () => void;
}

export const SelectorDiagramaEa: React.FC<Props> = ({
  archivo,
  diagramas,
  onElegir,
  onCancelar,
}) => (
  <div className='overlay' onClick={onCancelar} role='presentation'>
    <div
      className='modal'
      onClick={e => e.stopPropagation()}
      role='dialog'
      aria-label='Elegir el diagrama a importar'
    >
      <div className='modal__head'>
        <h3 className='modal__title'>Importar desde Enterprise Architect</h3>
        <button className='btn btn--ghost' onClick={onCancelar} aria-label='Cerrar'>
          ✕
        </button>
      </div>

      <p className='muted small' style={{ margin: '0 0 14px' }}>
        {archivo} · {diagramas.length} diagramas de clases. Elegí cuál abrir.
      </p>

      <div className='ea-lista'>
        {diagramas.map(d => (
          <button key={d.id} className='ea-lista__item' onClick={() => onElegir(d)}>
            <span className='ea-lista__nombre'>{d.nombre}</span>
            <span className='muted small'>
              {d.clases} {d.clases === 1 ? 'clase' : 'clases'} · {d.relaciones}{' '}
              {d.relaciones === 1 ? 'relación' : 'relaciones'}
              {d.paquete ? ` · ${d.paquete}` : ''}
            </span>
          </button>
        ))}
      </div>

      <div className='modal__foot'>
        <span className='muted small' style={{ marginRight: 'auto' }}>
          Se reemplaza el contenido de la pizarra actual.
        </span>
        <button className='btn' onClick={onCancelar}>
          Cancelar
        </button>
      </div>
    </div>
  </div>
);
