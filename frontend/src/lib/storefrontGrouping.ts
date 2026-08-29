// Groups a storefront's products under its seller-defined categories for
// the public templates (Modern / Minimal / Bold all render the same
// sections, just styled differently). Shared so the ordering + "hide empty
// category" + search-filter rules live in one place.

import type { PublicCategory, PublicProduct } from '@/lib/server/storefront';

export interface StorefrontSection {
  /** null = the implicit "Uncategorized" bucket, always rendered last. */
  category: PublicCategory | null;
  /** Stable anchor id for the category nav (slug, or "uncategorized"). */
  anchor: string;
  products: PublicProduct[];
}

const UNCATEGORIZED_ANCHOR = 'uncategorized';
export const UNCATEGORIZED_TITLE = 'Other';

/**
 * @param products  ACTIVE products, already in the order the store returns them
 * @param categories seller categories, already sorted by sortOrder
 * @param query     optional case-insensitive product-name filter
 * @returns ordered sections with at least one product each
 */
export function groupProductsByCategory(
  products: PublicProduct[],
  categories: PublicCategory[],
  query = '',
): StorefrontSection[] {
  const q = query.trim().toLowerCase();
  const visible = q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products;

  const byCategoryId = new Map<string, PublicProduct[]>();
  const uncategorized: PublicProduct[] = [];
  for (const p of visible) {
    if (p.category) {
      const list = byCategoryId.get(p.category.id) ?? [];
      list.push(p);
      byCategoryId.set(p.category.id, list);
    } else {
      uncategorized.push(p);
    }
  }

  const sections: StorefrontSection[] = [];
  const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const category of ordered) {
    const items = byCategoryId.get(category.id);
    if (items && items.length > 0) {
      sections.push({ category, anchor: category.slug, products: items });
    }
  }
  if (uncategorized.length > 0) {
    sections.push({ category: null, anchor: UNCATEGORIZED_ANCHOR, products: uncategorized });
  }
  return sections;
}

export function sectionTitle(section: StorefrontSection): string {
  return section.category?.name ?? UNCATEGORIZED_TITLE;
}

/** Phase 9b — the category's emoji, if the seller set one. */
export function sectionIcon(section: StorefrontSection): string | null {
  return section.category?.icon?.trim() || null;
}
