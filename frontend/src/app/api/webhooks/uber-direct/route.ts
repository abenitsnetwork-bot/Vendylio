/**
 * POST /api/webhooks/uber-direct — Uber Direct delivery-status webhook.
 *
 * Thin shim over the battle-tested factory at `lib/server/webhook/handler.ts`
 * (PROTECTED — never modified). The factory does the hard work: raw-body
 * read via arrayBuffer, HMAC verify, Serializable transaction, WebhookLog
 * upsert + dedup, dispatch, processedAt write-back. This file only wires:
 *   - the Uber Direct WebhookProvider (signature + payload parser, see
 *     lib/server/webhook/uber-direct.ts)
 *   - onPaid: the "paid" slot reused for "delivery completed" (status
 *     "delivered") — no dedicated slot exists in the generic factory, same
 *     precedent as Stripe Connect's account.updated handler
 *   - onFailed: courier cancellation/return — never auto-cancels the Order
 *     (a courier hiccup isn't proof the sale is void), but DOES mark the
 *     Delivery FAILED and revert the Order to READY so the seller's
 *     existing "Request Delivery" button works again instead of being
 *     permanently blocked by a dead Delivery row (see the
 *     DELIVERY_ALREADY_REQUESTED guard in api/orders/[id]/delivery/route.ts,
 *     which treats a FAILED delivery as retryable). Also alerts the seller.
 *
 * CLAUDE.md invariants honored here:
 *   - runtime = 'nodejs' + dynamic = 'force-dynamic' exported below.
 *   - This file NEVER reads the request body — the factory reads raw bytes
 *     for byte-identical HMAC verification.
 *   - Side-effects use enqueueOutbox(tx, ...) INSIDE the same Serializable
 *     tx the factory opens — never via after-commit closures.
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
import { enqueueOutbox } from '@/lib/server/outbox';

export const POST = createWebhookHandler<UberDirectWebhookPayload>({
  prisma,
  provider: uberDirectWebhookProvider,

  async onPaid(payload, tx) {
    const delivery = await tx.delivery.findFirst({
      where: { providerDeliveryId: payload.delivery_id },
      include: { order: { select: { id: true, storeId: true } } },
    });
    if (!delivery) return {}; // unknown delivery — log + drop, no DB row to update
    if (delivery.status === 'DELIVERED') return {}; // already processed

    await tx.delivery.update({
      where: { id: delivery.id },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });
    await tx.order.update({ where: { id: delivery.orderId }, data: { status: 'DELIVERED' } });
    await tx.orderStatusEvent.create({
      data: { orderId: delivery.orderId, status: 'DELIVERED', actorType: 'SYSTEM' },
    });

    const store = await tx.store.findUnique({
      where: { id: delivery.order.storeId },
      select: { organization: { select: { ownerId: true } } },
    });
    if (store) {
      await enqueueOutbox(tx, {
        kind: 'notification.delivery_completed',
        payload: { userId: store.organization.ownerId, orderId: delivery.orderId },
      });
    }
    // Phase 7 — customer "your order has been delivered" email.
    await enqueueOutbox(tx, {
      kind: 'email.order_status',
      payload: { orderId: delivery.orderId, kind: 'DELIVERED' },
    });

    return {};
  },

  async onFailed(payload, tx) {
    const delivery = await tx.delivery.findFirst({
      where: { providerDeliveryId: payload.delivery_id },
      include: { order: { select: { id: true, status: true, storeId: true } } },
    });
    if (!delivery) return {};
    if (delivery.status === 'FAILED') return {}; // already processed

    await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'FAILED' } });

    // Only revert an order still sitting OUT_FOR_DELIVERY because of THIS
    // delivery — an order the seller already moved on from some other way
    // (e.g. a manual refund) must not be silently pulled back to READY.
    if (delivery.order.status === 'OUT_FOR_DELIVERY') {
      await tx.order.update({ where: { id: delivery.orderId }, data: { status: 'READY' } });
      await tx.orderStatusEvent.create({
        data: { orderId: delivery.orderId, status: 'READY', actorType: 'SYSTEM' },
      });
    }

    const store = await tx.store.findUnique({
      where: { id: delivery.order.storeId },
      select: { organization: { select: { ownerId: true } } },
    });
    if (store) {
      await enqueueOutbox(tx, {
        kind: 'notification.delivery_failed',
        payload: {
          userId: store.organization.ownerId,
          orderId: delivery.orderId,
          status: payload.status,
        },
      });
    }
    // Phase 7 — calm customer-facing "there's a delay, the store has been
    // notified" email. Never exposes the provider status or a raw error.
    await enqueueOutbox(tx, {
      kind: 'email.order_status',
      payload: { orderId: delivery.orderId, kind: 'DELIVERY_ISSUE' },
    });

    return {};
  },
});
