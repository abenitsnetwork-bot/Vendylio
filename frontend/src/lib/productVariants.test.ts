import { describe, it, expect } from 'vitest';
import { variantLabel, effectivePriceCents, toAddableProduct } from './productVariants';

const VARIANT = { id: 'v1', name: 'Size', value: 'Large', priceDeltaCents: 200, quantity: 5 };

describe('variantLabel', () => {
  it('formats as "name: value"', () => {
    expect(variantLabel(VARIANT)).toBe('Size: Large');
  });
});

describe('effectivePriceCents', () => {
  it('adds the delta when a variant is given', () => {
    expect(effectivePriceCents(1800, VARIANT)).toBe(2000);
  });

  it('returns the base price when no variant is selected', () => {
    expect(effectivePriceCents(1800, null)).toBe(1800);
    expect(effectivePriceCents(1800, undefined)).toBe(1800);
  });
});

describe('toAddableProduct', () => {
  const PRODUCT = {
    id: 'prod-1',
    name: 'Shea Butter',
    priceCents: 1800,
    imageUrl: null,
    quantity: 10,
    unit: 'UNIT',
    variants: [VARIANT],
  };

  it('uses the product base price/quantity when no variant is selected', () => {
    const addable = toAddableProduct(PRODUCT, null);
    expect(addable).toMatchObject({ priceCents: 1800, quantity: 10 });
    expect(addable).not.toHaveProperty('variantId');
  });

  it('uses the variant price/quantity + label when one is selected', () => {
    const addable = toAddableProduct(PRODUCT, 'v1');
    expect(addable).toMatchObject({
      priceCents: 2000,
      quantity: 5,
      variantId: 'v1',
      variantLabel: 'Size: Large',
    });
  });

  it('falls back to the product base when the given variantId does not match', () => {
    const addable = toAddableProduct(PRODUCT, 'nope');
    expect(addable).toMatchObject({ priceCents: 1800, quantity: 10 });
  });
});
