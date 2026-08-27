import { describe, it, expect } from 'vitest';
import { roundQuantity, isValidQuantityForUnit } from './quantity';

describe('roundQuantity', () => {
  it('rounds to 2 decimal places', () => {
    expect(roundQuantity(12.0949999)).toBe(12.09);
    expect(roundQuantity(12.095)).toBe(12.1);
  });

  it('cleans up a typical float-arithmetic artifact', () => {
    expect(roundQuantity(20 - 7.91)).toBe(12.09);
  });

  it('leaves whole numbers untouched', () => {
    expect(roundQuantity(5)).toBe(5);
  });
});

describe('isValidQuantityForUnit', () => {
  it('requires a whole number for UNIT', () => {
    expect(isValidQuantityForUnit(3, 'UNIT')).toBe(true);
    expect(isValidQuantityForUnit(3.5, 'UNIT')).toBe(false);
  });

  it('allows any finite number for a weight unit', () => {
    expect(isValidQuantityForUnit(12.09, 'LB')).toBe(true);
    expect(isValidQuantityForUnit(5, 'KG')).toBe(true);
  });

  it('rejects non-finite values for a weight unit', () => {
    expect(isValidQuantityForUnit(NaN, 'KG')).toBe(false);
    expect(isValidQuantityForUnit(Infinity, 'KG')).toBe(false);
  });
});
