// Single source of truth for "how far along is this merchant's onboarding."
// Deliberately derives everything from fields the Store/Product models
// already have (see GET /api/stores/me) — no dedicated onboarding table or
// "completed step" flags. Plain module (no `server-only`) so both the
// onboarding wizard and the dashboard banner can import it client-side.

export type OnboardingStepKey =
  | 'business'
  | 'brand'
  | 'products'
  | 'payments'
  | 'delivery'
  | 'preview'
  | 'launch';

export const ONBOARDING_STEP_ORDER: OnboardingStepKey[] = [
  'business',
  'brand',
  'products',
  'payments',
  'delivery',
  'preview',
  'launch',
];

export const ONBOARDING_ROUTES: Record<OnboardingStepKey, string> = {
  business: '/onboarding/business',
  brand: '/onboarding/brand',
  products: '/onboarding/products',
  payments: '/onboarding/payments',
  delivery: '/onboarding/delivery',
  preview: '/onboarding/preview',
  launch: '/onboarding/launch',
};

export interface OnboardingStoreInput {
  logoUrl: string | null;
  template: string;
  stripeOnboardingStatus: string;
  deliveryProvider: string;
  pickupAddress: string | null;
  /** Phase 14 — a draft store is not yet public; `true` once the merchant has launched. */
  published: boolean;
}

export interface OnboardingProgress {
  hasStore: boolean;
  /** Brand is never a hard requirement — MODERN + no logo is a valid look. */
  brandCustomized: boolean;
  /** The one mandatory gate: a merchant with zero products has nothing to sell. */
  productsReady: boolean;
  /** Optional — this app already supports manual (Cash App/Zelle) payout. */
  paymentsReady: boolean;
  /** self_manual needs zero config; uber_direct needs a pickup address. */
  deliveryReady: boolean;
  /** Everything required before the merchant is allowed to launch (store + ≥1 product). */
  mandatoryComplete: boolean;
  /** The store is live: onboarding is done, don't nag the merchant to finish it. */
  launched: boolean;
  /** Ready to go live but hasn't pressed Launch yet — the dashboard nudges toward it. */
  readyToLaunch: boolean;
  /** Where `/onboarding` should redirect a returning merchant right now. */
  resumeRoute: string;
  /** A step is reachable once a store exists — business is the only hard lock. */
  canAccess: Record<OnboardingStepKey, boolean>;
  /** How many of the optional steps (brand/payments/delivery) are still undone — for encouraging copy, not gating. */
  incompleteOptionalCount: number;
}

export function computeOnboardingProgress(
  store: OnboardingStoreInput | null,
  productCount: number,
): OnboardingProgress {
  const hasStore = store !== null;
  const brandCustomized = hasStore && (Boolean(store.logoUrl) || store.template !== 'MODERN');
  const productsReady = productCount >= 1;
  const paymentsReady = hasStore && store.stripeOnboardingStatus === 'ACTIVE';
  const deliveryReady =
    hasStore && (store.deliveryProvider !== 'uber_direct' || Boolean(store.pickupAddress));
  const mandatoryComplete = hasStore && productsReady;
  const launched = hasStore && store.published;
  const readyToLaunch = mandatoryComplete && !launched;

  const canAccess = ONBOARDING_STEP_ORDER.reduce(
    (acc, step) => {
      acc[step] = step === 'business' ? true : hasStore;
      return acc;
    },
    {} as Record<OnboardingStepKey, boolean>,
  );

  const resumeRoute = !hasStore
    ? ONBOARDING_ROUTES.business
    : launched
      ? '/dashboard'
      : !productsReady
        ? ONBOARDING_ROUTES.products
        : ONBOARDING_ROUTES.launch;

  const incompleteOptionalCount = [brandCustomized, paymentsReady, deliveryReady].filter(
    (done) => !done,
  ).length;

  return {
    hasStore,
    brandCustomized,
    productsReady,
    paymentsReady,
    deliveryReady,
    mandatoryComplete,
    launched,
    readyToLaunch,
    resumeRoute,
    canAccess,
    incompleteOptionalCount,
  };
}
