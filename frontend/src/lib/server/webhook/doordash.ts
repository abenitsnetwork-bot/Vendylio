/**
 * DoorDash Drive webhook — delivery status updates.
 *
 * Auth (either, HMAC preferred):
 *   - `X-DoorDash-Signature`: hex HMAC-SHA256 of the raw body keyed by
 *     DOORDASH_WEBHOOK_SECRET (byte-identical scheme to the Uber verifier).
 *   - Basic Auth: `Authorization: Basic base64(user:pass)` against
 *     DOORDASH_WEBHOOK_USERNAME / DOORDASH_WEBHOOK_PASSWORD, when the account
 *     only offers that.
 *
 * Correlation uses `external_delivery_id` (our `vend_<deliveryId>`) against
 * Delivery.externalDeliveryId.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import type { WebhookProvider } from './handler';
import { normalizeDoorDashStatus } from '@/lib/server/fulfillment/providers/doordash';

export interface DoorDashWebhookPayload {
  event_name?: string;
  event_id?: string;
  external_delivery_id?: string;
  delivery_status?: string;
  delivery?: {
    external_delivery_id?: string;
    delivery_status?: string;
  };
  [k: string]: unknown;
}

function eq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function verifySignature(
  rawBody: Buffer,
  headers: Record<string, string>,
): { valid: boolean; reason?: string } {
  const secret = process.env.DOORDASH_WEBHOOK_SECRET;
  const user = process.env.DOORDASH_WEBHOOK_USERNAME;
  const pass = process.env.DOORDASH_WEBHOOK_PASSWORD;

  if (secret) {
    const sig = headers['x-doordash-signature'];
    if (!sig) return { valid: false, reason: 'missing X-DoorDash-Signature' };
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { valid: false, reason: 'signature mismatch' };
    }
    return { valid: true };
  }

  if (user && pass) {
    const auth = headers['authorization'] ?? '';
    if (!auth.startsWith('Basic ')) return { valid: false, reason: 'missing Basic auth' };
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const [u, p] = decoded.split(':');
    if (!u || !p || !eq(u, user) || !eq(p, pass)) {
      return { valid: false, reason: 'basic auth mismatch' };
    }
    return { valid: true };
  }

  return { valid: false, reason: 'DoorDash webhook auth not configured' };
}

function readIds(p: DoorDashWebhookPayload): { externalId: string; status: string } {
  const ext = p.external_delivery_id ?? p.delivery?.external_delivery_id ?? '';
  const status = (
    p.delivery_status ??
    p.delivery?.delivery_status ??
    p.event_name ??
    ''
  ).toString();
  const externalId = p.event_id ?? `${ext}:${status}`;
  return { externalId, status };
}

export const doorDashWebhookProvider: WebhookProvider<DoorDashWebhookPayload> = {
  name: 'doordash',
  verifySignature,
  parsePayload: (rawBody) => JSON.parse(rawBody.toString('utf8')) as DoorDashWebhookPayload,
  extractIds: (payload) => {
    const { externalId, status } = readIds(payload);
    const normalized = normalizeDoorDashStatus(status);
    return {
      externalId,
      eventType: status || 'unknown',
      kind:
        normalized === 'DELIVERED'
          ? 'paid'
          : normalized === 'CANCELLED' || normalized === 'FAILED'
            ? 'failed'
            : 'other',
    };
  },
};

/** The raw `external_delivery_id` on a payload (for the route's correlation). */
export function doorDashExternalDeliveryId(p: DoorDashWebhookPayload): string | null {
  return p.external_delivery_id ?? p.delivery?.external_delivery_id ?? null;
}

/** The raw provider status string on a payload. */
export function doorDashRawStatus(p: DoorDashWebhookPayload): string {
  return (p.delivery_status ?? p.delivery?.delivery_status ?? p.event_name ?? 'unknown').toString();
}
