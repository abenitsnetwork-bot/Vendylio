import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { accountsCreate, accountLinksCreate, accountsRetrieve } = vi.hoisted(() => ({
  accountsCreate: vi.fn(),
  accountLinksCreate: vi.fn(),
  accountsRetrieve: vi.fn(),
}));

vi.mock('stripe', () => {
  class FakeStripe {
    accounts = { create: accountsCreate, retrieve: accountsRetrieve };
    accountLinks = { create: accountLinksCreate };
  }
  return { default: FakeStripe };
});

import {
  createExpressAccount,
  createOnboardingLink,
  retrieveAccountCapabilities,
  StripeConnectUnconfiguredError,
  __resetStripeConnectClient,
} from './stripe-connect';

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  __resetStripeConnectClient();
  accountsCreate.mockReset();
  accountLinksCreate.mockReset();
  accountsRetrieve.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetStripeConnectClient();
});

describe('createExpressAccount', () => {
  it('throws StripeConnectUnconfiguredError when STRIPE_SECRET_KEY is missing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    await expect(createExpressAccount('seller@example.com')).rejects.toThrow(
      StripeConnectUnconfiguredError,
    );
  });

  it('creates an Express account with card_payments + transfers requested', async () => {
    accountsCreate.mockResolvedValue({ id: 'acct_new_1' });
    const id = await createExpressAccount('seller@example.com');
    expect(id).toBe('acct_new_1');
    expect(accountsCreate).toHaveBeenCalledWith({
      type: 'express',
      email: 'seller@example.com',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
  });
});

describe('createOnboardingLink', () => {
  it('creates an account_onboarding link with the given refresh/return URLs', async () => {
    accountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/acct_1' });
    const url = await createOnboardingLink(
      'acct_1',
      'https://vendylio.test/refresh',
      'https://vendylio.test/return',
    );
    expect(url).toBe('https://connect.stripe.com/setup/acct_1');
    expect(accountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_1',
      refresh_url: 'https://vendylio.test/refresh',
      return_url: 'https://vendylio.test/return',
      type: 'account_onboarding',
    });
  });
});

describe('retrieveAccountCapabilities', () => {
  it('reports both flags true when Stripe has fully enabled the account', async () => {
    accountsRetrieve.mockResolvedValue({ charges_enabled: true, payouts_enabled: true });
    const caps = await retrieveAccountCapabilities('acct_1');
    expect(caps).toEqual({ chargesEnabled: true, payoutsEnabled: true });
  });

  it('defaults missing/undefined flags to false rather than throwing', async () => {
    accountsRetrieve.mockResolvedValue({});
    const caps = await retrieveAccountCapabilities('acct_1');
    expect(caps).toEqual({ chargesEnabled: false, payoutsEnabled: false });
  });
});
