/**
 * POST /api/webhooks/uber-direct — Uber Direct delivery-status webhook.
 *
 * Thin shim over the PROTECTED `createWebhookHandler` factory (raw-body HMAC
 * verify, Serializable tx, WebhookLog dedup). Since Prompt #12 the actual
 * state change funnels through `fulfillmentService.applyCourierWebhookEvent`
 * — the SAME entry point the DoorDash webhook uses — which runs the normalized
 * state machine, writes a `DeliveryEvent` (idempotency gate), maps the
 * commercial `Order.status`, and enqueues the terminal seller notification +
 * customer email.
 *
 * `onPaid` / `onFailed` are the factory's terminal slots; intermediate courier
 * states are not delivered here (they come from the fulfillment-tick poll).
 * Correlation is on `payload.delivery_id` → `Delivery.providerDeliveryId`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import 'server-only';
import { createWebhookHandler } from '@/lib/server/webhook/handler';
import {
  uberDirectWebhookProvider,
  type UberDirectWebhookPayload,
} from '@/lib/server/webhook/uber-direct';
import { prisma } from '@/lib/server/prisma';
import { applyCourierWebhookEvent } from '@/lib/server/fulfillment/service';

export const POST = createWebhookHandler<UberDirectWebhookPayload>({
  prisma,
  provider: uberDirectWebhookProvider,

  async onPaid(payload, tx) {
    await applyCourierWebhookEvent(tx, {
      providerType: 'UBER_DIRECT',
      correlateBy: { providerDeliveryId: payload.delivery_id },
      rawStatus: payload.status,
      eventId: payload.id,
    });
    return {};
  },

  async onFailed(payload, tx) {
    await applyCourierWebhookEvent(tx, {
      providerType: 'UBER_DIRECT',
      correlateBy: { providerDeliveryId: payload.delivery_id },
      rawStatus: payload.status,
      eventId: payload.id,
    });
    return {};
  },
});
