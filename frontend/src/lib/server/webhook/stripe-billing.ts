// Phase 1a — WebhookProvider for the Vendylio Pro *subscription* webhook.
//
// A dedicated Stripe endpoint with its own signing secret
// (STRIPE_BILLING_WEBHOOK_SECRET), separate from the platform payment webhook
// (STRIPE_WEBHOOK_SECRET) and the Connect account webhook
// (STRIPE_CONNECT_WEBHOOK_SECRET) so a misconfiguration in one never blocks
// the others.
//
// The factory's `kind` vocabulary (paid|refunded|failed|other) has no
// "subscription lifecycle" bucket, so — exactly like webhook/stripe-connect.ts
// does for account.updated — we repurpose:
//   subscription.created / .updated  → 'paid'   (→ route onPaid)
//   invoice.paid                     → 'paid'   (→ route onPaid — Phase 1b
//                                                commission-invoice settlement)
//   checkout.session.completed       → 'paid'   (→ route onPaid — Phase 1b
//                                                card-setup default PM)
//   subscription.deleted             → 'failed' (→ route onFailed)
//   invoice.payment_failed           → 'failed' (→ route onFailed)
// The route branches on event.type for the shapes that land in each bucket.
import 'server-only';
import Stripe from 'stripe';
import type { WebhookProvider, ParsedIds } from './handler';
import { STRIPE_API_VERSION } from '../payments/stripe';

let _provider: WebhookProvider<Stripe.Event> | null = null;

const PAID_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'invoice.paid',
  'checkout.session.completed',
]);
const FAILED_EVENTS = new Set(['customer.subscription.deleted', 'invoice.payment_failed']);

/** Lazy-init — env reads happen at first call so `vi.stubEnv` works in tests. */
export function getStripeBillingWebhookProvider(): WebhookProvider<Stripe.Event> {
  if (_provider) return _provider;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  const webhookSecret = process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? '';
  if (!secretKey || !webhookSecret) {
    throw new Error('Stripe billing webhook provider not configured (env missing)');
  }
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });

  _provider = {
    name: 'stripe-billing',

    verifySignature(rawBody, headers) {
      const sig = headers['stripe-signature'];
      if (!sig) return { valid: false, reason: 'missing stripe-signature header' };
      try {
        stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        return { valid: true };
      } catch (err) {
        return { valid: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },

    parsePayload(rawBody) {
      return JSON.parse(rawBody.toString('utf8')) as Stripe.Event;
    },

    extractIds(event): ParsedIds {
      const kind: ParsedIds['kind'] = PAID_EVENTS.has(event.type)
        ? 'paid'
        : FAILED_EVENTS.has(event.type)
          ? 'failed'
          : 'other';
      return { externalId: event.id, eventType: event.type, kind };
    },
  };
  return _provider;
}

/** Convenience binding for the route file. */
export const stripeBillingWebhookProvider: WebhookProvider<Stripe.Event> = {
  name: 'stripe-billing',
  verifySignature: (raw, headers) =>
    getStripeBillingWebhookProvider().verifySignature(raw, headers),
  parsePayload: (raw) => getStripeBillingWebhookProvider().parsePayload(raw),
  extractIds: (payload) => getStripeBillingWebhookProvider().extractIds(payload),
};

/** Test-only — clear the cached provider for `vi.stubEnv` reuse. */
export function __resetStripeBillingWebhookProvider(): void {
  _provider = null;
}
