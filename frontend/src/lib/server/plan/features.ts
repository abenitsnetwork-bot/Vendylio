// Phase 1a — the single source of truth for "what does this plan unlock".
//
// `Store.plan` (FREE | PRO) is the value read everywhere; this module turns
// it into a concrete feature set. Pure + synchronous so both server routes
// and (via a thin client mirror) the UI can call it without a DB round-trip.
//
// The gates (promo codes, hero-image cap, AI quota, analytics, team, custom
// domain, …) consume `planFeatures()` + `requirePro()` from here so the policy
// lives in one place. Courier delivery (DoorDash / Uber Direct) is deliberately
// NOT gated — it is core to the platform; Free vs Pro differ on the commission
// rate + the subscription, not on being able to deliver.
import 'server-only';

export type Plan = 'FREE' | 'PRO';

export interface PlanFeatures {
  /** Create + apply promo codes (the Discount engine). */
  promoCodes: boolean;
  /** Storefront analytics page (visits, conversion, trends, export). */
  advancedAnalytics: boolean;
  /** Connect a custom domain (shop.brand.com). */
  customDomain: boolean;
  /** Invite staff with roles. */
  teamMembers: boolean;
  /** Max images in the storefront hero carousel. */
  heroImageLimit: number;
  /** Hide the "Powered by Vendylio" storefront badge. */
  whiteLabel: boolean;
  /** AI product-description generations per calendar month. null = unlimited. */
  aiMonthlyQuota: number | null;
  /** Bank / ACH payout method (via the merchant's connected Stripe account). */
  bankPayout: boolean;
  /** Raised daily withdrawal ceiling + no cooldown. */
  higherWithdrawalLimits: boolean;
}

const FREE: PlanFeatures = {
  promoCodes: false,
  advancedAnalytics: false,
  customDomain: false,
  teamMembers: false,
  heroImageLimit: 1,
  whiteLabel: false,
  aiMonthlyQuota: 5,
  bankPayout: false,
  higherWithdrawalLimits: false,
};

const PRO: PlanFeatures = {
  promoCodes: true,
  advancedAnalytics: true,
  customDomain: true,
  teamMembers: true,
  heroImageLimit: 3,
  whiteLabel: true,
  aiMonthlyQuota: null,
  bankPayout: true,
  higherWithdrawalLimits: true,
};

/** Normalise any stored `Store.plan` string to a known `Plan` (unknown → FREE). */
export function normalizePlan(plan: string | null | undefined): Plan {
  return plan === 'PRO' ? 'PRO' : 'FREE';
}

/** The feature set for a plan. Unknown / null plan strings resolve to FREE. */
export function planFeatures(plan: string | null | undefined): PlanFeatures {
  return normalizePlan(plan) === 'PRO' ? PRO : FREE;
}

export function isPro(store: { plan: string | null | undefined }): boolean {
  return normalizePlan(store.plan) === 'PRO';
}
