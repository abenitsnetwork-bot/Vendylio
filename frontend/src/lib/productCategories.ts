// Product categories are now per-store, seller-managed rows (see the
// `Category` model + /api/categories). This module keeps only what's still
// shared:
//   - DEFAULT_CATEGORIES: the starter set seeded for a brand-new store
//     (onboarding) — the same 4 the pre-Phase-1 hard-coded enum had.
//   - categoryLabel(): resolve a categoryId to a display name against a
//     fetched category list, with a stable fallback for uncategorized
//     products.

export interface CategoryOption {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
}

/** Seeded for every new store. Names only — slug/sortOrder are derived. */
export const DEFAULT_CATEGORIES = [
  'Food & Spices',
  'Beauty & Personal Care',
  'Textiles & Crafts',
  'Other',
] as const;

export const UNCATEGORIZED_LABEL = 'Uncategorized';

/** Resolve a product's categoryId to a name. `null`/unknown → Uncategorized. */
export function categoryLabel(
  categories: readonly CategoryOption[],
  categoryId: string | null | undefined,
): string {
  if (!categoryId) return UNCATEGORIZED_LABEL;
  return categories.find((c) => c.id === categoryId)?.name ?? UNCATEGORIZED_LABEL;
}
