'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

/**
 * Light ⇄ dark switch for the dashboard + admin nav. A real toggle: a track
 * with a sliding knob, sun on the light end, moon on the dark end. The choice
 * is stored per-device (localStorage) and applied app-wide (never on the
 * public storefront).
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
      onClick={toggle}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border border-border bg-secondary px-1 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <Sun
        size={13}
        strokeWidth={2.5}
        className={`absolute left-[7px] transition-opacity ${isDark ? 'opacity-30' : 'opacity-0'}`}
      />
      <Moon
        size={13}
        strokeWidth={2.5}
        className={`absolute right-[7px] transition-opacity ${isDark ? 'opacity-0' : 'opacity-30'}`}
      />
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-panel text-panel-foreground shadow-sm transition-transform ${
          isDark ? 'translate-x-6' : 'translate-x-0'
        }`}
      >
        {isDark ? <Moon size={13} strokeWidth={2.5} /> : <Sun size={13} strokeWidth={2.5} />}
      </span>
    </button>
  );
}

/** A labelled row for settings-style contexts. */
export function ThemeToggleRow() {
  const { theme } = useTheme();
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-foreground">Appearance</p>
        <p className="text-xs text-muted-foreground">
          {theme === 'dark' ? 'Dark mode' : 'Light mode'} · saved on this device
        </p>
      </div>
      <ThemeToggle />
    </div>
  );
}
