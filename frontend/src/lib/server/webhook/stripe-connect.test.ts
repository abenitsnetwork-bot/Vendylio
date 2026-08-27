import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import {
  stripeConnectWebhookProvider,
  getStripeConnectWebhookProvider,
  __resetStripeConnectWebhookProvider,
} from './stripe-connect';

const SECRET = 'test-connect-webhook-secret';

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', SECRET);
  __resetStripeConnectWebhookProvider();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetStripeConnectWebhookProvider();
});

describe('stripeConnectWebhookProvider (lazy-init wrapper)', () => {
  it('throws when STRIPE_CONNECT_WEBHOOK_SECRET is unset (lazy init)', () => {
    vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', '');
    __resetStripeConnectWebhookProvider();
    expect(() => getStripeConnectWebhookProvider()).toThrow(/not configured/i);
  });

  it('verifies a signature made with the Connect-specific secret', () => {
    const stripe = new Stripe('sk_test_fixture');
    const payload = JSON.stringify({ id: 'evt_1', type: 'account.updated' });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const result = stripeConnectWebhookProvider.verifySignature(Buffer.from(payload), {
      'stripe-signature': sig,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a signature made with a different secret (not interchangeable with the platform webhook secret)', () => {
    const stripe = new Stripe('sk_test_fixture');
    const payload = JSON.stringify({ id: 'evt_1', type: 'account.updated' });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: 'wrong-secret' });
    const result = stripeConnectWebhookProvider.verifySignature(Buffer.from(payload), {
      'stripe-signature': sig,
    });
    expect(result.valid).toBe(false);
  });

  it('extractIds routes account.updated through the "paid" bucket (see file header)', () => {
    const ids = stripeConnectWebhookProvider.extractIds({
      id: 'evt_1',
      type: 'account.updated',
    } as never);
    expect(ids).toEqual({ externalId: 'evt_1', eventType: 'account.updated', kind: 'paid' });
  });

  it('extractIds classifies every other event type as other (no-op)', () => {
    const ids = stripeConnectWebhookProvider.extractIds({
      id: 'evt_2',
      type: 'account.application.deauthorized',
    } as never);
    expect(ids.kind).toBe('other');
  });
});
