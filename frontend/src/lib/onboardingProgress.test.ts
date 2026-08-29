import { describe, it, expect } from 'vitest';
import { computeOnboardingProgress, ONBOARDING_ROUTES } from './onboardingProgress';

const DEFAULT_STORE = {
  logoUrl: null,
  template: 'MODERN',
  stripeOnboardingStatus: 'NOT_STARTED',
  deliveryProvider: 'self_manual',
  pickupAddress: null,
  published: false,
};

describe('computeOnboardingProgress', () => {
  it('with no store: nothing is ready, resumes at business, only business is reachable', () => {
    const progress = computeOnboardingProgress(null, 0);
    expect(progress.hasStore).toBe(false);
    expect(progress.mandatoryComplete).toBe(false);
    expect(progress.resumeRoute).toBe(ONBOARDING_ROUTES.business);
    expect(progress.canAccess.business).toBe(true);
    expect(progress.canAccess.products).toBe(false);
    expect(progress.canAccess.launch).toBe(false);
  });

  it('store exists but zero products: resumes at products, mandatory incomplete', () => {
    const progress = computeOnboardingProgress(DEFAULT_STORE, 0);
    expect(progress.hasStore).toBe(true);
    expect(progress.productsReady).toBe(false);
    expect(progress.mandatoryComplete).toBe(false);
    expect(progress.resumeRoute).toBe(ONBOARDING_ROUTES.products);
    // Once a store exists, every other step is reachable (no hard mid-flow locks).
    expect(progress.canAccess.brand).toBe(true);
    expect(progress.canAccess.payments).toBe(true);
    expect(progress.canAccess.delivery).toBe(true);
  });

  it('store + at least one product: mandatory complete, resumes at launch', () => {
    const progress = computeOnboardingProgress(DEFAULT_STORE, 1);
    expect(progress.mandatoryComplete).toBe(true);
    expect(progress.resumeRoute).toBe(ONBOARDING_ROUTES.launch);
    expect(progress.canAccess.launch).toBe(true);
    expect(progress.canAccess.preview).toBe(true);
  });

  it('brand is customized when a logo is set, even with the default template', () => {
    const progress = computeOnboardingProgress(
      { ...DEFAULT_STORE, logoUrl: 'https://x/logo.png' },
      0,
    );
    expect(progress.brandCustomized).toBe(true);
  });

  it('brand is customized when a non-default template is chosen, even with no logo', () => {
    const progress = computeOnboardingProgress({ ...DEFAULT_STORE, template: 'BOLD' }, 0);
    expect(progress.brandCustomized).toBe(true);
  });

  it('brand stays "not customized" on plain defaults — never blocks anything', () => {
    const progress = computeOnboardingProgress(DEFAULT_STORE, 1);
    expect(progress.brandCustomized).toBe(false);
    expect(progress.mandatoryComplete).toBe(true);
  });

  it('payments ready only when Stripe Connect is fully ACTIVE', () => {
    expect(computeOnboardingProgress(DEFAULT_STORE, 1).paymentsReady).toBe(false);
    expect(
      computeOnboardingProgress({ ...DEFAULT_STORE, stripeOnboardingStatus: 'PENDING' }, 1)
        .paymentsReady,
    ).toBe(false);
    expect(
      computeOnboardingProgress({ ...DEFAULT_STORE, stripeOnboardingStatus: 'ACTIVE' }, 1)
        .paymentsReady,
    ).toBe(true);
  });

  it('payments incompleteness never blocks mandatoryComplete — manual payout is a supported path', () => {
    const progress = computeOnboardingProgress(DEFAULT_STORE, 1);
    expect(progress.paymentsReady).toBe(false);
    expect(progress.mandatoryComplete).toBe(true);
  });

  it('delivery is ready by default (self_manual needs zero config)', () => {
    expect(computeOnboardingProgress(DEFAULT_STORE, 1).deliveryReady).toBe(true);
  });

  it('delivery is not ready when uber_direct is chosen without a pickup address', () => {
    const progress = computeOnboardingProgress(
      { ...DEFAULT_STORE, deliveryProvider: 'uber_direct' },
      1,
    );
    expect(progress.deliveryReady).toBe(false);
    // Still not a hard gate — the merchant can launch and fix delivery later.
    expect(progress.mandatoryComplete).toBe(true);
  });

  it('delivery is ready once uber_direct has a pickup address', () => {
    const progress = computeOnboardingProgress(
      { ...DEFAULT_STORE, deliveryProvider: 'uber_direct', pickupAddress: '1 Main St' },
      1,
    );
    expect(progress.deliveryReady).toBe(true);
  });

  it('counts incomplete optional steps for encouraging dashboard copy', () => {
    const allDefault = computeOnboardingProgress(DEFAULT_STORE, 1);
    // delivery is already "ready" on the self_manual default — only brand and payments are undone.
    expect(allDefault.incompleteOptionalCount).toBe(2);

    const allDone = computeOnboardingProgress(
      {
        logoUrl: 'https://x/logo.png',
        template: 'MODERN',
        stripeOnboardingStatus: 'ACTIVE',
        deliveryProvider: 'self_manual',
        pickupAddress: null,
        published: false,
      },
      1,
    );
    expect(allDone.incompleteOptionalCount).toBe(0);
  });

  it('store + product but still a draft: readyToLaunch, not launched, resumes at launch', () => {
    const progress = computeOnboardingProgress(DEFAULT_STORE, 1);
    expect(progress.mandatoryComplete).toBe(true);
    expect(progress.launched).toBe(false);
    expect(progress.readyToLaunch).toBe(true);
    expect(progress.resumeRoute).toBe(ONBOARDING_ROUTES.launch);
  });

  it('published store: launched, no longer readyToLaunch, resumes at the dashboard', () => {
    const progress = computeOnboardingProgress({ ...DEFAULT_STORE, published: true }, 1);
    expect(progress.launched).toBe(true);
    expect(progress.readyToLaunch).toBe(false);
    expect(progress.resumeRoute).toBe('/dashboard');
  });

  it('published but a product was archived down to zero: still counts as launched', () => {
    const progress = computeOnboardingProgress({ ...DEFAULT_STORE, published: true }, 0);
    expect(progress.launched).toBe(true);
    expect(progress.mandatoryComplete).toBe(false);
    expect(progress.readyToLaunch).toBe(false);
  });

  it('no store: never launched, not ready to launch', () => {
    const progress = computeOnboardingProgress(null, 0);
    expect(progress.launched).toBe(false);
    expect(progress.readyToLaunch).toBe(false);
  });
});
