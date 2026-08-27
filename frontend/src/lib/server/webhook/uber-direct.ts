/**
 * Uber Direct webhook — delivery status updates.
 *
 * Signature: `x-uber-signature` header (legacy alias `x-postmates-signature`)
 * is a hex HMAC-SHA256 of the raw request body, keyed by the per-webhook
 * signing key from the Uber Direct dashboard — UBER_DIRECT_WEBHOOK_SIGNING_KEY,
 * distinct from UBER_DIRECT_CLIENT_SECRET (which authenticates OUTBOUND API
 * calls in delivery/uber-direct.ts, not this inbound webhook).
 *
 * Payload shape targets Uber's DaaS-flavored "Delivery status" webhook
 * (`event.delivery_status`) — see the ⚠️ note atop delivery/uber-direct.ts
 * about the residual ambiguity between this and the similarly-named Eats
 * Orders webhook, which uses a different event name and payload shape
 * entirely. Verify against a real Uber Direct dashboard's test webhooks
 * before relying on this in production.
 *
 * Correlation deliberately uses `delivery_id` against our own
 * Delivery.providerDeliveryId (set when we created the delivery) rather than
 * the payload's `external_id` echo — the ambiguity above makes that field's
 * presence/shape the least trustworthy part of this contract.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type { WebhookProvider } from './handler';

export interface UberDirectWebhookPayload {
  id: string;
  kind: string;
  delivery_id: string;
  status: string;
  data?: Record<string, unknown>;
}

function verifySignature(
  rawBody: Buffer,
  headers: Record<string, string>,
): { valid: boolean; reason?: string } {
  const signingKey = process.env.UBER_DIRECT_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    return { valid: false, reason: 'UBER_DIRECT_WEBHOOK_SIGNING_KEY not configured' };
  }

  const signature = headers['x-uber-signature'] ?? headers['x-postmates-signature'];
  if (!signature) return { valid: false, reason: 'missing signature header' };

  const expected = createHmac('sha256', signingKey).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(signature, 'hex');
  if (expectedBuf.length !== givenBuf.length || !timingSafeEqual(expectedBuf, givenBuf)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true };
}

export const uberDirectWebhookProvider: WebhookProvider<UberDirectWebhookPayload> = {
  name: 'uber_direct',
  verifySignature,
  parsePayload: (rawBody) => JSON.parse(rawBody.toString('utf8')) as UberDirectWebhookPayload,
  extractIds: (payload) => ({
    externalId: payload.id,
    eventType: payload.status,
    kind:
      payload.status === 'delivered'
        ? 'paid'
        : payload.status === 'canceled' || payload.status === 'returned'
          ? 'failed'
          : 'other',
  }),
};
