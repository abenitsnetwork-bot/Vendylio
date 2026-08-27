// frontend/src/lib/server/webhook/stripe.ts — Phase 2.
//
// Re-exports the WebhookProvider impl from the payments adapter so the
// webhook namespace is cohesive (handler factory + per-provider impls),
// mirroring the pre-Phase-0 webhook/bictorys.ts shape. Lazy-init env reads
// so `vi.stubEnv` works in tests.
import 'server-only';
import type Stripe from 'stripe';
import type { WebhookProvider } from './handler';
import { createStripeProvider } from '../payments/stripe';

let _provider: WebhookProvider<Stripe.Event> | null = null;

/** Lazy-init — env reads happen at first call so `vi.stubEnv` works in tests. */
export function getStripeWebhookProvider(): WebhookProvider<Stripe.Event> {
  if (_provider) return _provider;
  const env = {
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? '',
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  };
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('Stripe webhook provider not configured (env missing)');
  }
  _provider = createStripeProvider(env).webhookProvider;
  return _provider;
}

/** Convenience binding for the route file. */
export const stripeWebhookProvider: WebhookProvider<Stripe.Event> = {
  name: 'stripe',
  verifySignature: (raw, headers) => getStripeWebhookProvider().verifySignature(raw, headers),
  parsePayload: (raw) => getStripeWebhookProvider().parsePayload(raw),
  extractIds: (payload) => getStripeWebhookProvider().extractIds(payload),
};

/** Test-only — clear the cached provider for `vi.stubEnv` reuse. */
export function __resetStripeWebhookProvider(): void {
  _provider = null;
}
