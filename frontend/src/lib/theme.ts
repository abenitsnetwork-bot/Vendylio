// Light / dark theme — shared constants + DOM helpers. No React here so the
// pre-paint inline script in layout.tsx and the ThemeContext can both use the
// same keys and logic.

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

export const THEME_STORAGE_KEY = 'vendylio-theme';

/**
 * Only the signed-in app surface follows the light/dark choice. Everything
 * else — the landing / marketing / legal pages, the auth entry pages
 * (login, register, verify-email, forgot/reset-password) and the public
 * storefront — always renders light. Allowlist, not denylist: a new public
 * page is light by default.
 */
export const THEMED_PREFIXES = ['/dashboard', '/admin', '/onboarding', '/settings'] as const;

export function isThemedPath(pathname: string): boolean {
  return THEMED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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

/** The self-contained script that runs before first paint to set data-theme on
 *  the themed routes only, so there is no flash of the wrong theme and the
 *  landing / marketing / storefront pages are never darkened. Kept as a string
 *  so layout.tsx can drop it into a nonce'd <script>. */
export const THEME_PREPAINT_SCRIPT = `(function(){try{
var p=location.pathname,P=${JSON.stringify(THEMED_PREFIXES)};
if(!P.some(function(x){return p===x||p.indexOf(x+'/')===0}))return;
var k=${JSON.stringify(THEME_STORAGE_KEY)},v=null;
try{v=localStorage.getItem(k)}catch(e){}
if(v!=='light'&&v!=='dark'){v=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
document.documentElement.dataset.theme=v;
}catch(e){}})();`;
