import { describe, it, expect } from 'vitest';
import { computeCommission, resolveCommissionRateBp } from './commission';

describe('computeCommission', () => {
  it('splits gross into commission + net at the given basis-point rate', () => {
    expect(computeCommission(3600, 600)).toEqual({ commission: 216, net: 3384 });
  });

  it('returns zero commission at rateBp 0', () => {
    expect(computeCommission(1000, 0)).toEqual({ commission: 0, net: 1000 });
  });

  it('floors the commission (favors the recipient)', () => {
    // 999 * 333 / 10000 = 33.2667 -> floors to 33
    expect(computeCommission(999, 333)).toEqual({ commission: 33, net: 966 });
  });

  it('throws on a non-integer gross', () => {
    expect(() => computeCommission(10.5, 600)).toThrow();
  });

  it('throws on a negative gross', () => {
    expect(() => computeCommission(-1, 600)).toThrow();
  });

  it('throws on a rateBp outside 0..10000', () => {
    expect(() => computeCommission(1000, 10_001)).toThrow();
    expect(() => computeCommission(1000, -1)).toThrow();
  });
});

describe('resolveCommissionRateBp (Phase 12 — Free/Pro tiers)', () => {
  it('FREE plan always uses the base rate', () => {
    expect(resolveCommissionRateBp({ plan: 'FREE', baseRateBp: 600, proRateBp: 300 })).toBe(600);
  });

  it('PRO plan uses the discounted rate when COMMISSION_RATE_BP_PRO is configured', () => {
    expect(resolveCommissionRateBp({ plan: 'PRO', baseRateBp: 600, proRateBp: 300 })).toBe(300);
  });

  it('PRO plan falls back to the base rate when no PRO rate is configured (proRateBp: null)', () => {
    expect(resolveCommissionRateBp({ plan: 'PRO', baseRateBp: 600, proRateBp: null })).toBe(600);
  });

  it('an unrecognized plan value behaves like FREE', () => {
    expect(resolveCommissionRateBp({ plan: 'ENTERPRISE', baseRateBp: 600, proRateBp: 300 })).toBe(
      600,
    );
  });
});
