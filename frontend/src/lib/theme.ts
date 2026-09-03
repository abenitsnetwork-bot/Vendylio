// Light / dark theme — shared constants + DOM helpers. No React here so the
// pre-paint inline script in layout.tsx and the ThemeContext can both use the
// same keys and logic.

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

export const THEME_STORAGE_KEY = 'vendylio-theme';

/** The public storefront is always light — it's the customer's view, styled by
 *  the merchant's chosen template, not the merchant's personal preference.
 *  `/s/*` covers the platform domain; the `storefront` marker (set by
 *  src/app/s/[slug]/layout.tsx) covers connected custom domains where the
 *  browser path is just `/`. */
export function isThemedPath(pathname: string): boolean {
  if (pathname.startsWith('/s/')) return false;
  if (typeof document !== 'undefined' && document.documentElement.dataset.storefront === '1') {
    return false;
  }
  return true;
}

export function systemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The stored explicit choice, or 'system' when the user hasn't picked one. */
export function readThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(choice: ThemeChoice): Theme {
  return choice === 'system' ? systemTheme() : choice;
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function persistThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* private mode / storage disabled — the in-memory state still works for the session */
  }
}

/** The self-contained script that runs in <head> before first paint to set
 *  data-theme, so there is no flash of the wrong theme. Kept as a string so
 *  layout.tsx can drop it into a nonce'd <script>. */
export const THEME_PREPAINT_SCRIPT = `(function(){try{
if(location.pathname.indexOf('/s/')===0)return;
var k=${JSON.stringify(THEME_STORAGE_KEY)},v=null;
try{v=localStorage.getItem(k)}catch(e){}
if(v!=='light'&&v!=='dark'){v=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
document.documentElement.dataset.theme=v;
}catch(e){}})();`;
