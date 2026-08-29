import { describe, it, expect } from 'vitest';
import { roundedSellerCount, sellerProof, MIN_SELLERS_FOR_PROOF } from './socialProof';

describe('roundedSellerCount', () => {
  it('rounds down to the nearest 10 below 100', () => {
    expect(roundedSellerCount(37)).toBe(30);
    expect(roundedSellerCount(99)).toBe(90);
  });

  it('rounds down to the nearest 50 below 1000', () => {
    expect(roundedSellerCount(123)).toBe(100);
    expect(roundedSellerCount(989)).toBe(950);
  });

  it('rounds down to the nearest 100 at 1000+', () => {
    expect(roundedSellerCount(1234)).toBe(1200);
    expect(roundedSellerCount(1099)).toBe(1000);
  });
});

describe('sellerProof', () => {
  it('hides the proof element below the threshold', () => {
    expect(sellerProof(0)).toEqual({ show: false, label: '' });
    expect(sellerProof(MIN_SELLERS_FOR_PROOF - 1)).toEqual({ show: false, label: '' });
  });

  it('shows a conservatively-rounded label at or above the threshold', () => {
    expect(sellerProof(MIN_SELLERS_FOR_PROOF)).toEqual({ show: true, label: '10+' });
    expect(sellerProof(1234)).toEqual({ show: true, label: '1,200+' });
  });

  it('never overstates — the rounded label is <= the real count', () => {
    for (const n of [15, 63, 100, 247, 999, 1000, 5432]) {
      expect(roundedSellerCount(n)).toBeLessThanOrEqual(n);
    }
  });

  it('is safe for non-finite input', () => {
    expect(sellerProof(NaN)).toEqual({ show: false, label: '' });
  });
});
