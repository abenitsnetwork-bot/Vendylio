import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import {
  stripeWebhookProvider,
  getStripeWebhookProvider,
  __resetStripeWebhookProvider,
} from './stripe';

const SECRET = 'test-webhook-secret';

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  __resetStripeWebhookProvider();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetStripeWebhookProvider();
});

describe('stripeWebhookProvider (lazy-init wrapper)', () => {
  it('throws when env is unset (lazy init)', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    __resetStripeWebhookProvider();
    expect(() => getStripeWebhookProvider()).toThrow(/not configured/i);
  });

  it('delegates verifySignature to the lazily-constructed provider', () => {
    const stripe = new Stripe('sk_test_fixture');
    const payload = JSON.stringify({ id: 'evt_1' });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    const result = stripeWebhookProvider.verifySignature(Buffer.from(payload), {
      'stripe-signature': sig,
    });
    expect(result.valid).toBe(true);
  });

  it('delegates parsePayload and extractIds to the lazily-constructed provider', () => {
    const raw = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' }));
    const parsed = stripeWebhookProvider.parsePayload(raw);
    expect(parsed).toMatchObject({ id: 'evt_1' });
    const ids = stripeWebhookProvider.extractIds(parsed);
    expect(ids).toEqual({
      externalId: 'evt_1',
      eventType: 'checkout.session.completed',
      kind: 'paid',
    });
  });

  it('caches the provider across calls (single construction)', () => {
    const a = getStripeWebhookProvider();
    const b = getStripeWebhookProvider();
    expect(a).toBe(b);
  });
});
