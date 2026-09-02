import { describe, it, expect } from 'vitest';
import { evaluateDiscount, normalizeDiscountCode, type DiscountInput } from './evaluate';

const now = new Date('2026-09-01T12:00:00Z');
const valid: DiscountInput = {
  kind: 'FREE_DELIVERY',
  percentOff: null,
  active: true,
  startsAt: null,
  endsAt: null,
  minSubtotalCents: 0,
  maxRedemptions: null,
  redemptionCount: 0,
};
const ctx = { subtotalCents: 5000, deliveryFeeCents: 599, now };

describe('evaluateDiscount', () => {
  it('NOT_FOUND when the code does not exist', () => {
    expect(evaluateDiscount(null, ctx)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
      discountCents: 0,
      deliveryFeeCents: 599,
      subtotalDiscountCents: 0,
    });
  });

  it('FREE_DELIVERY waives the whole delivery fee', () => {
    expect(evaluateDiscount(valid, ctx)).toEqual({
      ok: true,
      discountCents: 599,
      deliveryFeeCents: 0,
      subtotalDiscountCents: 0,
    });
  });

  it('is a no-op (still ok) when there was no delivery fee to begin with', () => {
    expect(evaluateDiscount(valid, { ...ctx, deliveryFeeCents: 0 })).toEqual({
      ok: true,
      discountCents: 0,
      deliveryFeeCents: 0,
      subtotalDiscountCents: 0,
    });
  });

  it('rejects when the cart is under the minimum subtotal', () => {
    const r = evaluateDiscount({ ...valid, minSubtotalCents: 6000 }, ctx);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('MIN_SUBTOTAL');
    expect(r.deliveryFeeCents).toBe(599); // fee unchanged
  });

  it('propagates the seller-facing status reasons', () => {
    expect(evaluateDiscount({ ...valid, active: false }, ctx).reason).toBe('OFF');
    expect(evaluateDiscount({ ...valid, startsAt: new Date('2026-09-05') }, ctx).reason).toBe(
      'SCHEDULED',
    );
    expect(evaluateDiscount({ ...valid, endsAt: new Date('2026-08-20') }, ctx).reason).toBe(
      'EXPIRED',
    );
    expect(evaluateDiscount({ ...valid, maxRedemptions: 3, redemptionCount: 3 }, ctx).reason).toBe(
      'EXHAUSTED',
    );
  });

  describe('PERCENT', () => {
    const pct = (percentOff: number | null): DiscountInput => ({
      ...valid,
      kind: 'PERCENT',
      percentOff,
    });

    it('takes the percentage off the subtotal, leaving the delivery fee', () => {
      expect(evaluateDiscount(pct(20), ctx)).toEqual({
        ok: true,
        discountCents: 1000, // 20% of 5000
        deliveryFeeCents: 599, // unchanged
        subtotalDiscountCents: 1000,
      });
    });

    it('rounds to the nearest cent', () => {
      const r = evaluateDiscount(pct(15), { ...ctx, subtotalCents: 3333 });
      expect(r.discountCents).toBe(500); // round(499.95)
    });

    it('never discounts more than the subtotal', () => {
      const r = evaluateDiscount(pct(100), ctx);
      expect(r.discountCents).toBe(5000);
      expect(r.subtotalDiscountCents).toBe(5000);
    });

    it('fails closed on a misconfigured percentage', () => {
      expect(evaluateDiscount(pct(null), ctx).ok).toBe(false);
      expect(evaluateDiscount(pct(0), ctx).ok).toBe(false);
      expect(evaluateDiscount(pct(150), ctx).ok).toBe(false);
    });

    it('still honours the min-subtotal gate', () => {
      expect(evaluateDiscount({ ...pct(20), minSubtotalCents: 6000 }, ctx).reason).toBe(
        'MIN_SUBTOTAL',
      );
    });
  });

  it('treats an unknown kind as not applicable rather than throwing', () => {
    expect(evaluateDiscount({ ...valid, kind: 'MYSTERY' }, ctx)).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
      discountCents: 0,
      deliveryFeeCents: 599,
      subtotalDiscountCents: 0,
    });
  });

  it('normalizeDiscountCode trims + uppercases', () => {
    expect(normalizeDiscountCode('  freeship ')).toBe('FREESHIP');
  });
});
