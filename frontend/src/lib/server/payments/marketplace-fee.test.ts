import { describe, it, expect } from 'vitest';
import { calculateMarketplaceFee } from './marketplace-fee';

describe('calculateMarketplaceFee', () => {
  it('computes the canonical bp math', () => {
    expect(calculateMarketplaceFee({ taxableAmountCents: 10_000, commissionRateBp: 500 })).toBe(
      500,
    );
    expect(calculateMarketplaceFee({ taxableAmountCents: 10_000, commissionRateBp: 150 })).toBe(
      150,
    );
  });

  it('floors rather than rounds', () => {
    // 999 * 500 / 10000 = 49.95
    expect(calculateMarketplaceFee({ taxableAmountCents: 999, commissionRateBp: 500 })).toBe(49);
  });

  it('a zero taxable base yields zero commission regardless of rate', () => {
    expect(calculateMarketplaceFee({ taxableAmountCents: 0, commissionRateBp: 500 })).toBe(0);
  });

  it('a zero rate yields zero commission regardless of base', () => {
    expect(calculateMarketplaceFee({ taxableAmountCents: 10_000, commissionRateBp: 0 })).toBe(0);
  });

  it('never introduces floating point — every input/output stays an integer', () => {
    const result = calculateMarketplaceFee({ taxableAmountCents: 333, commissionRateBp: 333 });
    expect(Number.isInteger(result)).toBe(true);
  });

  it('worked example — $100 merchandise, $10 percentage discount, 5% rate', () => {
    // Merchandise subtotal $100 (10000c), PERCENT discount $10 (1000c) →
    // taxable base $90 (9000c). Delivery/tax are never passed in here at all
    // — the exclusion is structural, not a branch this function has to get
    // right.
    const taxableAmountCents = 10_000 - 1_000;
    expect(calculateMarketplaceFee({ taxableAmountCents, commissionRateBp: 500 })).toBe(450);
  });
});
