/**
 * The single canonical marketplace-commission calculation (Financial
 * Architecture Lock, Phase 2B). Every payment path — Stripe Connect, the
 * Stripe platform charge, Cash App, Zelle — must derive Vendylio's cut from
 * this function and nothing else, so the same order can never be charged one
 * commission by Stripe and recorded at a different one in the ledger.
 *
 * Deliberately pure: no Stripe, no Prisma, no PlatformSettings read, no env,
 * no network, no knowledge of HTTP. It receives exactly the two numbers the
 * commission decision depends on and returns one number. The caller (order
 * creation — see api/orders/route.ts) is responsible for resolving those two
 * inputs once and freezing them on the Order row; this function is not where
 * "once" is enforced, only where the math is.
 */
import 'server-only';
import { computeCommission } from './commission';

export interface MarketplaceFeeInput {
  /**
   * Merchandise subtotal minus the merchandise-attributable discount — never
   * delivery, never tax. A PERCENT discount count here in full (it reduces
   * merchandise); a FREE_DELIVERY discount does not (it reduces delivery,
   * which was never part of this number to begin with).
   */
  taxableAmountCents: number;
  /** Resolved Free/Pro rate in basis points, from PlatformSettings. */
  commissionRateBp: number;
}

/** floor(taxableAmountCents * commissionRateBp / 10000), integer cents. */
export function calculateMarketplaceFee(input: MarketplaceFeeInput): number {
  return computeCommission(input.taxableAmountCents, input.commissionRateBp).commission;
}
