import { describe, it, expect } from 'vitest';
import { groupProductsByCategory, sectionTitle, sectionIcon } from './storefrontGrouping';
import type { PublicCategory, PublicProduct } from '@/lib/server/storefront';

const cat = (
  id: string,
  name: string,
  sortOrder: number,
  icon: string | null = null,
): PublicCategory => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  icon,
  sortOrder,
});

const prod = (id: string, name: string, category: PublicProduct['category']): PublicProduct => ({
  id,
  name,
  description: null,
  priceCents: 100,
  quantity: 1,
  category,
  unit: 'UNIT',
  imageUrl: null,
  variants: [],
});

const food = cat('c-food', 'Food', 0, '🍞');
const crafts = cat('c-crafts', 'Crafts', 1);

describe('groupProductsByCategory', () => {
  it('orders sections by category sortOrder and puts uncategorized last', () => {
    const sections = groupProductsByCategory(
      [
        prod('p1', 'Loose item', null),
        prod('p2', 'Honey', { id: 'c-food', name: 'Food', slug: 'food' }),
        prod('p3', 'Scarf', { id: 'c-crafts', name: 'Crafts', slug: 'crafts' }),
      ],
      [crafts, food], // deliberately out of order — function sorts by sortOrder
    );
    expect(sections.map((s) => sectionTitle(s))).toEqual(['Food', 'Crafts', 'Other']);
    expect(sections.map((s) => s.anchor)).toEqual(['food', 'crafts', 'uncategorized']);
  });

  it('sectionIcon returns the category emoji, or null (uncategorized / no icon set)', () => {
    const sections = groupProductsByCategory(
      [
        prod('p1', 'Loose item', null),
        prod('p2', 'Honey', { id: 'c-food', name: 'Food', slug: 'food' }),
        prod('p3', 'Scarf', { id: 'c-crafts', name: 'Crafts', slug: 'crafts' }),
      ],
      [food, crafts],
    );
    expect(sections.map(sectionIcon)).toEqual(['🍞', null, null]);
  });

  it('drops categories with no matching products', () => {
    const sections = groupProductsByCategory(
      [prod('p2', 'Honey', { id: 'c-food', name: 'Food', slug: 'food' })],
      [food, crafts],
    );
    expect(sections).toHaveLength(1);
    expect(sectionTitle(sections[0]!)).toBe('Food');
  });

  it('filters by a case-insensitive name query before grouping', () => {
    const sections = groupProductsByCategory(
      [
        prod('p2', 'Raw Honey', { id: 'c-food', name: 'Food', slug: 'food' }),
        prod('p3', 'Wool Scarf', { id: 'c-crafts', name: 'Crafts', slug: 'crafts' }),
      ],
      [food, crafts],
      'HONEY',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.products.map((p) => p.id)).toEqual(['p2']);
  });

  it('returns an empty array when nothing matches the query', () => {
    const sections = groupProductsByCategory(
      [prod('p2', 'Honey', { id: 'c-food', name: 'Food', slug: 'food' })],
      [food],
      'zzz',
    );
    expect(sections).toEqual([]);
  });
});
