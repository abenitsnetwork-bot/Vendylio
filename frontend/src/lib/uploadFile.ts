// Thin multipart upload helper for POST /api/upload. Kept separate from
// `@/lib/api` (protected — JSON-only, no-retry-on-mutation contract) since
// file uploads need FormData, not a JSON body.
import { API_URL, COOKIE_PREFIX } from './constants';
import { ApiError } from './api';

const CSRF_STORAGE_KEY = `${COOKIE_PREFIX}-csrf`;
const CSRF_COOKIE_NAME = `${COOKIE_PREFIX}-csrf`;

// Mirrors the fallback in `@/lib/api`'s private getCsrfToken(): localStorage
// isn't refreshed by every auth path (GET /api/auth/me doesn't return a
// csrfToken), so a page reload can leave it stale/empty while the readable
// `app-csrf` cookie is still valid. Without this fallback, uploads 403 on
// any session that didn't just go through a fresh login/verify/refresh.
function getCsrfToken(): string | null {
  if (typeof window === 'undefined') return null;
  const fromStorage = localStorage.getItem(CSRF_STORAGE_KEY);
  if (fromStorage) return fromStorage;
  const escaped = CSRF_COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

export async function uploadFile(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);

  const headers: Record<string, string> = {};
  const csrfToken = getCsrfToken();
  if (csrfToken) headers['x-csrf-token'] = csrfToken;

  const res = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(res.status, (body as { message?: string }).message ?? 'Upload failed', body);
  }
  return res.json() as Promise<{ url: string }>;
}
