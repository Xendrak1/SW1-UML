import React, { useEffect, useRef, useState } from 'react';

/**
 * Menú desplegable. Agrupar las acciones en menús es lo que permite bajar la
 * barra de 18 botones sueltos a media docena de controles.
 *
 * Cierra al hacer clic fuera, con Escape, y al elegir una opción.
 */

interface MenuProps {
  label: React.ReactNode;
  icon?: string;
  children: (cerrar: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  title?: string;
  variant?: 'default' | 'primary' | 'ghost';
  minWidth?: number;
}

export const Menu: React.FC<MenuProps> = ({
  label,
  icon,
  children,
  align = 'left',
  title,
  variant = 'default',
  minWidth,
}) => {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const alClic = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) setAbierto(false);
    };
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    // 'true' para capturar antes de que el lienzo procese el clic.
    document.addEventListener('mousedown', alClic, true);
    document.addEventListener('keydown', alTeclado);
    return () => {
      document.removeEventListener('mousedown', alClic, true);
      document.removeEventListener('keydown', alTeclado);
    };
  }, [abierto]);

  const clase =
    variant === 'primary' ? 'btn btn--primary' : variant === 'ghost' ? 'btn btn--ghost' : 'btn';

  return (
    <div className='menu-wrap' ref={ref}>
      <button
        className={`${clase}${abierto ? ' btn--active' : ''}`}
        onClick={() => setAbierto(v => !v)}
        title={title}
        aria-expanded={abierto}
        aria-haspopup='menu'
      >
        {icon && <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>}
        <span className='btn__label'>{label}</span>
        <span style={{ fontSize: 9, opacity: 0.55, marginLeft: 1 }}>▾</span>
      </button>

      {abierto && (
        <div
          className={`menu${align === 'right' ? ' menu--right' : ''}`}
          style={minWidth ? { minWidth } : undefined}
          role='menu'
        >
          {children(() => setAbierto(false))}
        </div>
      )}
    </div>
  );
};

interface ItemProps {
  icon?: string;
  hint?: string;
  danger?: boolean;
  current?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

export const MenuItem: React.FC<ItemProps> = ({
  icon,
  hint,
  danger,
  current,
  disabled,
  onClick,
  children,
}) => (
  <button
    className={`menu__item${danger ? ' menu__item--danger' : ''}${current ? ' menu__item--current' : ''}`}
    onClick={onClick}
    disabled={disabled}
    role='menuitem'
  >
    {icon !== undefined && <span className='menu__icon'>{icon}</span>}
    <span style={{ flex: 1 }}>{children}</span>
    {hint && <span className='menu__hint'>{hint}</span>}
  </button>
);

export const MenuLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className='menu__label'>{children}</div>
);

export const MenuDivider: React.FC = () => <div className='menu__divider' />;
