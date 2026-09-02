// Phase D — decide whether a promo code applies to a checkout and what it's
// worth. Single source of truth, called from POST /api/orders (authoritative
// pricing) and GET /api/discounts/validate (checkout preview).
//
// Mechanisms:
//   FREE_DELIVERY — waives the whole delivery fee.
//   PERCENT       — takes `percentOff`% off the cart subtotal (1..100).
// An unknown `kind` (or a misconfigured PERCENT with no percentOff) is treated
// as not-applicable rather than throwing, so a forward-declared row created by
// a newer dashboard can't 500 an older checkout.
import 'server-only';
import { discountStatus, type DiscountStatus } from '@/lib/discountStatus';

export type DiscountFailReason = Exclude<DiscountStatus, 'ACTIVE'> | 'NOT_FOUND' | 'MIN_SUBTOTAL';

export interface DiscountInput {
  kind: string;
  /** Whole percent 1..100 — only meaningful when kind === 'PERCENT'. */
  percentOff: number | null;
  active: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  minSubtotalCents: number;
  maxRedemptions: number | null;
  redemptionCount: number;
}

export interface DiscountResult {
  ok: boolean;
  reason?: DiscountFailReason;
  /** Total cents the buyer saves (waived delivery fee, or the % off subtotal). */
  discountCents: number;
  /** Delivery fee after the discount (0 for a valid FREE_DELIVERY code). */
  deliveryFeeCents: number;
  /** Cents taken off the subtotal (>0 only for PERCENT). */
  subtotalDiscountCents: number;
}

export function evaluateDiscount(
  discount: DiscountInput | null,
  ctx: { subtotalCents: number; deliveryFeeCents: number; now?: Date },
): DiscountResult {
  const noop = {
    discountCents: 0,
    deliveryFeeCents: ctx.deliveryFeeCents,
    subtotalDiscountCents: 0,
  };
  if (!discount) return { ok: false, reason: 'NOT_FOUND', ...noop };

  const status = discountStatus(discount, ctx.now ?? new Date());
  if (status !== 'ACTIVE') return { ok: false, reason: status, ...noop };

  if (ctx.subtotalCents < discount.minSubtotalCents) {
    return { ok: false, reason: 'MIN_SUBTOTAL', ...noop };
  }

  if (discount.kind === 'FREE_DELIVERY') {
    return {
      ok: true,
      discountCents: ctx.deliveryFeeCents,
      deliveryFeeCents: 0,
      subtotalDiscountCents: 0,
    };
  }

  if (discount.kind === 'PERCENT') {
    const pct = discount.percentOff ?? 0;
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      // Misconfigured row — fail closed rather than charge a wrong total.
      return { ok: false, reason: 'NOT_FOUND', ...noop };
    }
    const cut = Math.min(ctx.subtotalCents, Math.round((ctx.subtotalCents * pct) / 100));
    return {
      ok: true,
      discountCents: cut,
      deliveryFeeCents: ctx.deliveryFeeCents,
      subtotalDiscountCents: cut,
    };
  }

  return { ok: false, reason: 'NOT_FOUND', ...noop };
}

/** Normalize a raw code the way it's stored + looked up. */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}
