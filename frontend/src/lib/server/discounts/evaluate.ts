// Phase D — decide whether a promo code applies to a checkout and what it's
// worth. Single source of truth, called from POST /api/orders (authoritative
// pricing) and GET /api/discounts/validate (checkout preview).
//
// V1 mechanism: FREE_DELIVERY only. An unknown `kind` is treated as
// not-applicable rather than throwing, so a forward-declared PERCENT/FIXED
// row created by a newer dashboard can't 500 an older checkout.
import 'server-only';
import { discountStatus, type DiscountStatus } from '@/lib/discountStatus';

export type DiscountFailReason = Exclude<DiscountStatus, 'ACTIVE'> | 'NOT_FOUND' | 'MIN_SUBTOTAL';

export interface DiscountInput {
  kind: string;
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
  /** Cents the buyer saves — for FREE_DELIVERY, the waived delivery fee. */
  discountCents: number;
  /** Delivery fee after the discount (0 for a valid FREE_DELIVERY code). */
  deliveryFeeCents: number;
}

export function evaluateDiscount(
  discount: DiscountInput | null,
  ctx: { subtotalCents: number; deliveryFeeCents: number; now?: Date },
): DiscountResult {
  const noop = { discountCents: 0, deliveryFeeCents: ctx.deliveryFeeCents };
  if (!discount) return { ok: false, reason: 'NOT_FOUND', ...noop };

  const status = discountStatus(discount, ctx.now ?? new Date());
  if (status !== 'ACTIVE') return { ok: false, reason: status, ...noop };

  if (ctx.subtotalCents < discount.minSubtotalCents) {
    return { ok: false, reason: 'MIN_SUBTOTAL', ...noop };
  }

  if (discount.kind === 'FREE_DELIVERY') {
    return { ok: true, discountCents: ctx.deliveryFeeCents, deliveryFeeCents: 0 };
  }
  return { ok: false, reason: 'NOT_FOUND', ...noop };
}

/** Normalize a raw code the way it's stored + looked up. */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}
