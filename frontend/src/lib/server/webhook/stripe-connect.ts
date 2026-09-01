// frontend/src/lib/server/webhook/stripe-connect.ts — Phase 3.
//
// A separate WebhookProvider + lazy-init wrapper for Connect account
// lifecycle events (`account.updated`), signed with their own dedicated
// secret (STRIPE_CONNECT_WEBHOOK_SECRET) — Stripe issues a distinct signing
// secret for a Connect-scoped webhook endpoint, separate from the platform
// payment webhook's STRIPE_WEBHOOK_SECRET. Kept apart from webhook/stripe.ts
// so a payment webhook misconfiguration can never block account-status sync
// or vice versa.
import 'server-only';
import Stripe from 'stripe';
import type { WebhookProvider, ParsedIds } from './handler';
import { STRIPE_API_VERSION } from '../payments/stripe';

let _provider: WebhookProvider<Stripe.Event> | null = null;

/** Lazy-init — env reads happen at first call so `vi.stubEnv` works in tests. */
export function getStripeConnectWebhookProvider(): WebhookProvider<Stripe.Event> {
  if (_provider) return _provider;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? '';
  if (!secretKey || !webhookSecret) {
    throw new Error('Stripe Connect webhook provider not configured (env missing)');
  }
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });

  _provider = {
    name: 'stripe-connect',

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
      // createWebhookHandler's `kind` vocabulary is fixed to
      // paid|refunded|failed|other, all payment-shaped — there's no
      // "account lifecycle" bucket and no generic catch-all handler ('other'
      // silently no-ops). We repurpose:
      //   account.updated   → 'paid'   (Connect account status sync)
      //   transfer.reversed → 'failed' (Phase 2 — a BANK payout bounced)
      // rather than duplicating the factory's HMAC+dedup+Serializable-tx
      // logic (PROTECTED, deliberately not reimplemented).
      const kind: ParsedIds['kind'] =
        event.type === 'account.updated'
          ? 'paid'
          : event.type === 'transfer.reversed'
            ? 'failed'
            : 'other';
      return { externalId: event.id, eventType: event.type, kind };
    },
  };
  return _provider;
}

/** Convenience binding for the route file. */
export const stripeConnectWebhookProvider: WebhookProvider<Stripe.Event> = {
  name: 'stripe-connect',
  verifySignature: (raw, headers) =>
    getStripeConnectWebhookProvider().verifySignature(raw, headers),
  parsePayload: (raw) => getStripeConnectWebhookProvider().parsePayload(raw),
  extractIds: (payload) => getStripeConnectWebhookProvider().extractIds(payload),
};

/** Test-only — clear the cached provider for `vi.stubEnv` reuse. */
export function __resetStripeConnectWebhookProvider(): void {
  _provider = null;
}
