import { describe, it, expect } from 'vitest';
import {
  PRODUCT_UNIT_VALUES,
  productUnitLabel,
  productUnitSuffix,
  formatUsdPerUnit,
  formatQuantityWithUnit,
} from './productUnits';

describe('productUnits', () => {
  it('PRODUCT_UNIT_VALUES includes UNIT plus the weight units', () => {
    expect(PRODUCT_UNIT_VALUES).toEqual(['UNIT', 'LB', 'KG', 'G', 'OZ']);
  });

  it('productUnitLabel falls back to the raw value for an unknown unit', () => {
    expect(productUnitLabel('KG')).toBe('Per kilogram (kg)');
    expect(productUnitLabel('WEIRD')).toBe('WEIRD');
  });

  it('productUnitSuffix is empty for UNIT and "/kg" style for weight units', () => {
    expect(productUnitSuffix('UNIT')).toBe('');
    expect(productUnitSuffix('KG')).toBe('/kg');
    expect(productUnitSuffix('LB')).toBe('/lb');
  });

  it('formatUsdPerUnit appends the unit suffix only for non-UNIT', () => {
    expect(formatUsdPerUnit(500, 'UNIT')).toBe('$5.00');
    expect(formatUsdPerUnit(500, 'KG')).toBe('$5.00/kg');
  });

  it('formatQuantityWithUnit shows a bare integer for UNIT and always 2 decimals for a weight unit', () => {
    expect(formatQuantityWithUnit(3, 'UNIT')).toBe('3');
    expect(formatQuantityWithUnit(2, 'KG')).toBe('2.00 kg');
    expect(formatQuantityWithUnit(12.09, 'LB')).toBe('12.09 lb');
    // A float-arithmetic artifact never reaches the UI.
    expect(formatQuantityWithUnit(12.089999999999998, 'LB')).toBe('12.09 lb');
  });
});
