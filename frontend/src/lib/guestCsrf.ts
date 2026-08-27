import { COOKIE_PREFIX } from '@/lib/constants';

/**
 * Resolves a value for the x-csrf-token header for guest (unauthenticated)
 * mutations — checkout, post-delivery reviews — without touching the
 * protected lib/api.ts wrapper (which assumes a logged-in session).
 *
 * `verifyCsrf` (lib/server/auth.ts) only requires the header be *present*
 * when there's no CSRF cookie at all — it skips the cookie-match check in
 * that case — so any non-empty value works for a true guest. A visitor who
 * happens to already be logged in (e.g. a seller testing their own store)
 * DOES have a real csrf cookie — reuse it so their session's actual token
 * is echoed back correctly.
 */
export function guestCsrfHeaderValue(): string {
  const name = `${COOKIE_PREFIX}-csrf`;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  if (match?.[1]) return decodeURIComponent(match[1]);
  return crypto.randomUUID();
}
