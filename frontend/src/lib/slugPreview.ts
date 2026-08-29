/**
 * Client-side preview only — mirrors the shape of the server's `slugify`
 * (lib/server/slug.ts, protected) closely enough to show a live "your link
 * will look like this" preview as the merchant types. The server remains the
 * single source of truth for uniqueness and collision suffixing
 * (`ensureUniqueSlug`) — this never needs to match it byte-for-byte.
 */
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function previewSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
