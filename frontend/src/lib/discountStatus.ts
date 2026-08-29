// Phase D — the current state of a promo code, from the seller's point of
// view. Pure + framework-free so both the dashboard (client) and the
// checkout evaluation (server) share one definition.

export type DiscountStatus = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'OFF' | 'EXHAUSTED';

export interface DiscountStatusInput {
  active: boolean;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
}

export function discountStatus(d: DiscountStatusInput, now: Date = new Date()): DiscountStatus {
  if (!d.active) return 'OFF';
  if (d.maxRedemptions !== null && d.redemptionCount >= d.maxRedemptions) return 'EXHAUSTED';
  const start = d.startsAt ? new Date(d.startsAt) : null;
  const end = d.endsAt ? new Date(d.endsAt) : null;
  if (start && now < start) return 'SCHEDULED';
  if (end && now > end) return 'EXPIRED';
  return 'ACTIVE';
}

export const DISCOUNT_STATUS_LABEL: Record<DiscountStatus, string> = {
  ACTIVE: 'Active',
  SCHEDULED: 'Scheduled',
  EXPIRED: 'Expired',
  OFF: 'Off',
  EXHAUSTED: 'Limit reached',
};
