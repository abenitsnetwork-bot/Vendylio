// Light / dark theme — shared constants + DOM helpers. No React here so the
// pre-paint inline script in layout.tsx and the ThemeContext can both use the
// same keys and logic.

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

/** Generic key: the pre-paint script's best-effort cache of the last theme
 *  shown on this browser. The authoritative choice is per-account (see
 *  themeStorageKey) — this only avoids a flash before the account loads. */
export const THEME_STORAGE_KEY = 'vendylio-theme';

/** Per-account key so a shared browser keeps each profile's choice separate.
 *  Falls back to the generic key when signed out. */
export function themeStorageKey(userId?: string | null): string {
  return userId ? `${THEME_STORAGE_KEY}:${userId}` : THEME_STORAGE_KEY;
}

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

/** The stored explicit choice for a key, or 'system' when none is set. */
export function readThemeChoice(key: string = THEME_STORAGE_KEY): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = window.localStorage.getItem(key);
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

/** Write a choice to one or more keys (the per-account key + the generic
 *  pre-paint cache). 'system' clears the key. */
export function persistThemeChoice(
  choice: ThemeChoice,
  keys: string[] = [THEME_STORAGE_KEY],
): void {
  try {
    for (const key of keys) {
      if (choice === 'system') window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, choice);
    }
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
