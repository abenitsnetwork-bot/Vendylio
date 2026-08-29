// Phase 9 — storefront hero carousel. Shared between the server read
// (lib/server/storefront.ts), the PATCH validation (api/stores/route.ts),
// and the seller-side editor (components/seller/StoreHeroEditor.tsx).

export const MAX_HERO_IMAGES = 3;

export interface StoreHero {
  /** Ordered, up to MAX_HERO_IMAGES image URLs. */
  images: string[];
  /** One global promo line overlaid on every slide. */
  headline: string | null;
  subhead: string | null;
}

/**
 * Normalize a raw `Store.heroImages` JSON value into a clean string[]. Drops
 * anything that isn't a non-empty string and caps the length — a malformed
 * row must never break the public storefront.
 */
export function parseHeroImages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .slice(0, MAX_HERO_IMAGES);
}
