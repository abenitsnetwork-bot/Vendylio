'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import {
  applyTheme,
  isThemedPath,
  persistThemeChoice,
  readThemeChoice,
  resolveTheme,
  systemTheme,
  type Theme,
  type ThemeChoice,
} from '@/lib/theme';

interface ThemeContextValue {
  /** What the user picked: 'light' | 'dark' | 'system'. */
  choice: ThemeChoice;
  /** The theme actually in effect right now. */
  theme: Theme;
  setChoice: (choice: ThemeChoice) => void;
  /** light ⇄ dark, from whatever is currently in effect. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const themed = isThemedPath(pathname);

  // SSR renders with the default (light) tokens; the pre-paint script in
  // layout.tsx has already set data-theme before React hydrates, so there is
  // no visible flash. These states catch up on mount.
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const c = readThemeChoice();
    setChoiceState(c);
    setTheme(resolveTheme(c));
  }, []);

  // Follow the OS while the user is on 'system'.
  useEffect(() => {
    if (choice !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(systemTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  // Reflect the effective theme onto <html> — but never dark on a storefront
  // route (those pages always render light).
  useEffect(() => {
    applyTheme(themed ? theme : 'light');
  }, [theme, themed]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    persistThemeChoice(next);
    setTheme(resolveTheme(next));
  }, []);

  const toggle = useCallback(() => {
    setChoiceState((prevChoice) => {
      const effective = resolveTheme(prevChoice);
      const next: ThemeChoice = effective === 'dark' ? 'light' : 'dark';
      persistThemeChoice(next);
      setTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ choice, theme, setChoice, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
