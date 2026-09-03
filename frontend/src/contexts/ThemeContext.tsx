'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  applyTheme,
  isThemedPath,
  persistThemeChoice,
  readThemeChoice,
  resolveTheme,
  systemTheme,
  themeStorageKey,
  THEME_STORAGE_KEY,
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
  // The choice is stored per account (themeStorageKey) so a shared browser
  // keeps each profile separate; the generic key is only the pre-paint cache.
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  const [theme, setTheme] = useState<Theme>('light');

  // Load this account's stored choice whenever the signed-in user changes
  // (initial mount, login, logout, account switch on a shared browser).
  useEffect(() => {
    const c = readThemeChoice(themeStorageKey(userId));
    setChoiceState(c);
    setTheme(resolveTheme(c));
  }, [userId]);

  // Follow the OS while the user is on 'system'.
  useEffect(() => {
    if (choice !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(systemTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);

  // Reflect the effective theme onto <html> — but never dark on a route that
  // isn't part of the signed-in app surface.
  useEffect(() => {
    applyTheme(themed ? theme : 'light');
  }, [theme, themed]);

  const commit = useCallback(
    (next: ThemeChoice) => {
      setChoiceState(next);
      setTheme(resolveTheme(next));
      // Per-account key = the source of truth; generic key = pre-paint cache
      // (so a returning user sees no flash).
      persistThemeChoice(next, [themeStorageKey(userId), THEME_STORAGE_KEY]);
    },
    [userId],
  );

  const toggle = useCallback(() => {
    setChoiceState((prev) => {
      const next: ThemeChoice = resolveTheme(prev) === 'dark' ? 'light' : 'dark';
      setTheme(next);
      persistThemeChoice(next, [themeStorageKey(userId), THEME_STORAGE_KEY]);
      return next;
    });
  }, [userId]);

  return (
    <ThemeContext.Provider value={{ choice, theme, setChoice: commit, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
