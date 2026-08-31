/**
 * POST /api/webhooks/doordash — DoorDash Drive delivery-status webhook.
 *
 * Mirror of the Uber Direct webhook: a thin shim over the PROTECTED
 * `createWebhookHandler` factory, funnelling every state change through
 * `fulfillmentService.applyCourierWebhookEvent`. Auth is HMAC
 * (`X-DoorDash-Signature`) with a Basic-Auth fallback — see
 * `lib/server/webhook/doordash.ts`. Correlation is on `external_delivery_id`
 * (our `vend_<deliveryId>`) → `Delivery.externalDeliveryId`.
 *
 * Terminal slots only (`delivered` → paid, `cancelled`/`failed`/`returned` →
 * failed); intermediate courier states come from the fulfillment-tick poll.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import 'server-only';
import { createWebhookHandler, type PrismaTransactionClient } from '@/lib/server/webhook/handler';
import {
  doorDashWebhookProvider,
  doorDashExternalDeliveryId,
  doorDashRawStatus,
  type DoorDashWebhookPayload,
} from '@/lib/server/webhook/doordash';
import { prisma } from '@/lib/server/prisma';
import { applyCourierWebhookEvent } from '@/lib/server/fulfillment/service';

async function handle(payload: DoorDashWebhookPayload, tx: PrismaTransactionClient) {
  const ext = doorDashExternalDeliveryId(payload);
  if (!ext) return {};
  await applyCourierWebhookEvent(tx, {
    providerType: 'DOORDASH',
    correlateBy: { externalDeliveryId: ext },
    rawStatus: doorDashRawStatus(payload),
    eventId: payload.event_id ?? `${ext}:${doorDashRawStatus(payload)}`,
  });
  return {};
}

export const POST = createWebhookHandler<DoorDashWebhookPayload>({
  prisma,
  provider: doorDashWebhookProvider,
  onPaid: handle,
  onFailed: handle,
});
