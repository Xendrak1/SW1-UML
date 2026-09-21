import { createContext, useContext } from 'react';

/**
 * Contexto del tema, separado de los componentes.
 *
 * Está en su propio archivo porque un módulo que exporta componentes y además
 * hooks o constantes rompe el reemplazo en caliente de Vite.
 */

export type ThemePref = 'light' | 'dark' | 'system';
export type ThemeResolved = 'light' | 'dark';

export const THEME_KEY = 'case.theme';

export interface ThemeContextValue {
  pref: ThemePref;
  theme: ThemeResolved;
  setPref: (p: ThemePref) => void;
  /** Alterna claro/oscuro de forma explícita, dejando de seguir al sistema. */
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export const leerPreferencia = (): ThemePref => {
  try {
    const guardada = localStorage.getItem(THEME_KEY);
    if (guardada === 'light' || guardada === 'dark' || guardada === 'system') return guardada;
  } catch {
    /* localStorage bloqueado */
  }
  return 'system';
};

export const preferenciaDelSistema = (): ThemeResolved =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Permite renderizar un componente aislado (una prueba, por ejemplo) sin el provider.
    return {
      pref: 'system',
      theme: preferenciaDelSistema(),
      setPref: () => undefined,
      toggle: () => undefined,
    };
  }
  return ctx;
}
