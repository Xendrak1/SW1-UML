import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  leerPreferencia,
  preferenciaDelSistema,
  THEME_KEY,
  ThemeContext,
  useTheme,
  type ThemePref,
  type ThemeResolved,
} from './themeContext';

/**
 * Tema claro / oscuro.
 *
 * Tres estados en vez de dos: 'system' sigue la preferencia del sistema operativo,
 * que es lo que espera alguien que tiene el modo oscuro programado por horario.
 * La elección se guarda en localStorage y se aplica poniendo data-theme en <html>,
 * de donde lo toman los tokens CSS de styles/theme.css.
 */

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pref, setPrefState] = useState<ThemePref>(leerPreferencia);
  const [sistema, setSistema] = useState<ThemeResolved>(preferenciaDelSistema);

  // Si el usuario eligió 'system', hay que reaccionar cuando el sistema cambie.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSistema(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: ThemeResolved = pref === 'system' ? sistema : pref;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    // color-scheme hace que los controles nativos (barras de desplazamiento,
    // selects, inputs de archivo) también se dibujen oscuros.
    root.style.colorScheme = theme;

    // La barra de estado del navegador móvil acompaña al tema.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1116' : '#f4f5f7');
  }, [theme]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {
      /* sin persistencia; el tema vale para esta sesión */
    }
  }, []);

  const toggle = useCallback(() => {
    setPref(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setPref]);

  const value = useMemo(() => ({ pref, theme, setPref, toggle }), [pref, theme, setPref, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/** Botón de tema: un clic alterna, el clic derecho permite volver a seguir al sistema. */
export const ThemeToggle: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { pref, theme, setPref, toggle } = useTheme();
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const cerrar = () => setAbierto(false);
    window.addEventListener('click', cerrar);
    return () => window.removeEventListener('click', cerrar);
  }, [abierto]);

  return (
    <div className='menu-wrap' onClick={e => e.stopPropagation()}>
      <button
        className={compact ? 'btn btn--icon' : 'btn'}
        onClick={toggle}
        onContextMenu={e => {
          e.preventDefault();
          setAbierto(v => !v);
        }}
        title={`Tema: ${pref === 'system' ? `sistema (${theme})` : pref}. Clic para alternar, clic derecho para más opciones.`}
        aria-label='Cambiar tema'
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>{theme === 'dark' ? '☾' : '☀'}</span>
        {!compact && <span className='btn__label'>{theme === 'dark' ? 'Oscuro' : 'Claro'}</span>}
      </button>

      {abierto && (
        <div className='menu menu--right'>
          <div className='menu__label'>Tema</div>
          {(['light', 'dark', 'system'] as ThemePref[]).map(p => (
            <button
              key={p}
              className={`menu__item${pref === p ? ' menu__item--current' : ''}`}
              onClick={() => {
                setPref(p);
                setAbierto(false);
              }}
            >
              <span className='menu__icon'>{p === 'light' ? '☀' : p === 'dark' ? '☾' : '⌥'}</span>
              {p === 'light' ? 'Claro' : p === 'dark' ? 'Oscuro' : 'Seguir al sistema'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
