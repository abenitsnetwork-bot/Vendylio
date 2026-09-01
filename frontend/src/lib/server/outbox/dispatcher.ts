/**
 * Outbox dispatcher — drains PENDING OutboxEvent rows and routes each to
 * the correct side-effect handler.
 *
 *   draining order: oldest scheduledAt first.
 *   on success: row.status = SENT, sentAt = now.
 *   on failure: row.attempts++, lastError = err.message; if attempts <
 *               maxAttempts the row is rescheduled (status PENDING +
 *               scheduledAt += backoff), else marked DEAD.
 *
 * The dispatcher is single-instance safe via a per-row claim:
 *   UPDATE OutboxEvent SET status = 'PROCESSING', attempts = attempts + 1
 *   WHERE id = $1 AND status = 'PENDING'
 *   RETURNING id;
 *
 * Two competing workers see at most one of them claim each row (the other's
 * UPDATE returns 0 rows). For multi-instance prod a Redis-leader-election
 * variant is recommended on top of this — single-instance is the v1 stance.
 *
 * Backoff: 30s, 2m, 10m, 30m, 1h. Max 5 attempts before DEAD.
 */
import type { PrismaClient } from '@prisma/client';
import { createNotification } from '../notifications/index';
import {
  orderPaid,
  orderUnfulfilled,
  deliveryCompleted,
  deliveryFailed,
  lowStockNotification,
  outOfStockNotification,
} from '../notifications/templates';
import { isChannelEnabled } from '../notifications/prefs-merge';
import type { EmailQueue } from '../queues/email-queue';
import { createLogger } from '../logger';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { OutboxEvent } from './types';

const logger = createLogger();

const MAX_ATTEMPTS = 5;
const BACKOFF_MS: readonly number[] = [
  30_000, // 30s
  2 * 60_000, // 2 min
  10 * 60_000, // 10 min
  30 * 60_000, // 30 min
  60 * 60_000, // 1 h
];

export interface OutboxDispatcherDeps {
  prisma: PrismaClient;
  emailQueue?: EmailQueue;
}

/**
 * Process up to `batchSize` PENDING events whose scheduledAt has elapsed.
 * Returns count successfully processed (success or terminal failure).
 */
export async function drainOutbox(
  deps: OutboxDispatcherDeps,
  batchSize: number = 25,
): Promise<{ processed: number; succeeded: number; failed: number; dead: number }> {
  const now = new Date();
  const candidates = await deps.prisma.outboxEvent.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: batchSize,
    select: { id: true },
  });

  let succeeded = 0;
  let failed = 0;
  let dead = 0;

  for (const candidate of candidates) {
    // Per-row atomic claim — guards against concurrent dispatchers.
    const claimed = await deps.prisma.outboxEvent.updateMany({
      where: { id: candidate.id, status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) continue; // another worker got it

    const row = await deps.prisma.outboxEvent.findUnique({
      where: { id: candidate.id },
    });
    if (!row) continue;

    const event: OutboxEvent = {
      kind: row.kind as OutboxEvent['kind'],
      payload: row.payload as OutboxEvent['payload'],
    } as OutboxEvent;

    try {
      await dispatchEvent(deps, event);
      await deps.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), lastError: null },
      });
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (row.attempts >= MAX_ATTEMPTS) {
        await deps.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { status: 'DEAD', lastError: message },
        });
        dead++;
        logger.error('outbox: event DEAD', { id: row.id, kind: row.kind, lastError: message });
      } else {
        const idx = Math.min(row.attempts - 1, BACKOFF_MS.length - 1);
        const delay = BACKOFF_MS[Math.max(0, idx)] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
        await deps.prisma.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: 'PENDING',
            lastError: message,
            scheduledAt: new Date(Date.now() + delay),
          },
        });
        failed++;
        logger.warn('outbox: event failed (will retry)', {
          id: row.id,
          kind: row.kind,
          attempts: row.attempts,
          retryInMs: delay,
          lastError: message,
        });
      }
    }
  }

  return { processed: candidates.length, succeeded, failed, dead };
}

/**
 * Phase 4 — stamp `lowStockNotifiedAt = now()` after a low/out-of-stock
 * notification is sent, so it isn't re-emitted until stock recovers (which
 * resets it to null — see inventory/adjust.ts). The `lowStockNotifiedAt: null`
 * guard makes a duplicate dispatch a no-op.
 */
async function markLowStockNotified(
  prisma: PrismaClient,
  productId: string,
  variantId: string | null,
): Promise<void> {
  const now = new Date();
  if (variantId) {
    await prisma.productVariant.updateMany({
      where: { id: variantId, lowStockNotifiedAt: null },
      data: { lowStockNotifiedAt: now },
    });
  } else {
    await prisma.product.updateMany({
      where: { id: productId, lowStockNotifiedAt: null },
      data: { lowStockNotifiedAt: now },
    });
  }
}

/**
 * Phase 7 — resolve the human "VND-…" reference for an order. Falls back to
 * the raw id if the row vanished (so a notification body is never blank).
 */
async function orderReference(prisma: PrismaClient, orderId: string): Promise<string> {
  const row = await prisma.order.findUnique({
    where: { id: orderId },
    select: { orderNumber: true },
  });
  return row ? formatOrderNumber(row.orderNumber) : orderId;
}

/** Route a single event to the correct handler. */
async function dispatchEvent(deps: OutboxDispatcherDeps, event: OutboxEvent): Promise<void> {
  switch (event.kind) {
    case 'email.verification_code': {
      // Phase 1 — emitted by signup + resend-verification routes. Phase 5's
      // email-queue cron will render via verificationEmail() and call enqueue.
      // O1 audit fix — thread `expiresAt` so the rendered TTL matches the
      // route-side `AUTH_VERIFICATION_TTL_MIN` env (was hardcoded "15 min").
      if (!deps.emailQueue) throw new Error('email queue not configured');
      const { verificationEmail } = await import('../auth/email-templates');
      const { to, code, expiresAt } = event.payload;
      const tpl = verificationEmail({ code, email: to, expiresAt });
      await deps.emailQueue.enqueue({ to, subject: tpl.subject, html: tpl.html });
      return;
    }
    case 'email.password_reset': {
      // Phase 1 — emitted by forgot-password route.
      // O1 audit fix — thread `expiresAt` (see email.verification_code above).
      if (!deps.emailQueue) throw new Error('email queue not configured');
      const { resetPasswordEmail } = await import('../auth/email-templates');
      const { to, code, expiresAt } = event.payload;
      const tpl = resetPasswordEmail({ code, email: to, expiresAt });
      await deps.emailQueue.enqueue({ to, subject: tpl.subject, html: tpl.html });
      return;
    }
    case 'notification.order_paid': {
      // Phase 2 — emitted by the Stripe webhook's onPaid handler. Phase 7 —
      // render the human "VND-…" reference in the notification body.
      const { userId, orderId, amount, currency } = event.payload;
      const ref = await orderReference(deps.prisma, orderId);
      await createNotification(deps.prisma, orderPaid(userId, orderId, amount, currency, ref));
      return;
    }
    case 'email.order_new_seller': {
      // NOTIF-01 — the store owner's operational "new order" email. Recipient +
      // order details resolved from the order row; skipped when the owner opted
      // out of the ORDER_PAID email channel (default-on) or the store/owner
      // vanished. Email failure retries via the outbox — never touches the order.
      if (!deps.emailQueue) throw new Error('email queue not configured');
      const { resolveSellerOrderEmailContext } = await import('../emails/sellerOrderEmailContext');
      const { orderNewSellerEmail } = await import('../emails/sellerEmails');
      const resolved = await resolveSellerOrderEmailContext(deps.prisma, event.payload.orderId);
      if (!resolved) return;
      if (!isChannelEnabled(resolved.prefs, 'ORDER_PAID', 'email')) return;
      const tpl = orderNewSellerEmail(resolved.context);
      await deps.emailQueue.enqueue({
        to: resolved.to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      return;
    }
    case 'notification.order_unfulfilled': {
      // ORD-01 — in-app nudge for a paid order the seller hasn't progressed.
      // Deduped once-per-order by createNotification.
      const { userId, orderId, hoursWaiting } = event.payload;
      const ref = await orderReference(deps.prisma, orderId);
      await createNotification(deps.prisma, orderUnfulfilled(userId, orderId, hoursWaiting, ref));
      return;
    }
    case 'email.order_unfulfilled': {
      // ORD-01 — the email sibling of notification.order_unfulfilled.
      if (!deps.emailQueue) throw new Error('email queue not configured');
      const { resolveSellerOrderEmailContext } = await import('../emails/sellerOrderEmailContext');
      const { orderUnfulfilledReminderEmail } = await import('../emails/sellerEmails');
      const resolved = await resolveSellerOrderEmailContext(deps.prisma, event.payload.orderId);
      if (!resolved) return;
      if (!isChannelEnabled(resolved.prefs, 'ORDER_UNFULFILLED', 'email')) return;
      const tpl = orderUnfulfilledReminderEmail(resolved.context, event.payload.hoursWaiting);
      await deps.emailQueue.enqueue({
        to: resolved.to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      return;
    }
    case 'email.order_confirmation': {
      // Phase 2/7 — emitted by markPaid.ts once payment is authoritative.
      // Recipient + branded template data come from the order row, never the
      // payload (§118). No customerEmail on the order → nothing to send.
      if (!deps.emailQueue) throw new Error('email queue not configured');
      const { resolveOrderEmailContext } = await import('../emails/orderEmailContext');
      const { orderConfirmationEmail } = await import('../emails/orderEmails');
      const resolved = await resolveOrderEmailContext(deps.prisma, event.payload.orderId);
      if (!resolved) return;
      const tpl = orderConfirmationEmail(resolved.context);
      await deps.emailQueue.enqueue({
        to: resolved.to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      return;
    }
    case 'email.order_status': {
      // Phase 7 — customer status emails (being prepared / on the way /
      // delivered / delivery issue). Emitted by the seller status routes and
      // the Uber Direct webhook.
      if (!deps.emailQueue) throw new Error('email queue not configured');
      const { resolveOrderEmailContext } = await import('../emails/orderEmailContext');
      const { orderStatusUpdateEmail } = await import('../emails/orderEmails');
      const resolved = await resolveOrderEmailContext(deps.prisma, event.payload.orderId);
      if (!resolved) return;
      const tpl = orderStatusUpdateEmail(resolved.context, event.payload.kind);
      await deps.emailQueue.enqueue({
        to: resolved.to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      return;
    }
    case 'email.order_refunded': {
      // Phase 7 — emitted by POST /api/orders/[id]/refund.
      if (!deps.emailQueue) throw new Error('email queue not configured');
      const { resolveOrderEmailContext } = await import('../emails/orderEmailContext');
      const { orderRefundedEmail } = await import('../emails/orderEmails');
      const resolved = await resolveOrderEmailContext(deps.prisma, event.payload.orderId);
      if (!resolved) return;
      const tpl = orderRefundedEmail(resolved.context);
      await deps.emailQueue.enqueue({
        to: resolved.to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
      return;
    }
    case 'notification.delivery_completed': {
      // Uber Direct — emitted by the delivery webhook's onPaid handler.
      const { userId, orderId } = event.payload;
      await createNotification(deps.prisma, deliveryCompleted(userId, orderId));
      return;
    }
    case 'notification.delivery_failed': {
      // Uber Direct — emitted by the delivery webhook's onFailed handler.
      const { userId, orderId, status } = event.payload;
      const ref = await orderReference(deps.prisma, orderId);
      await createNotification(deps.prisma, deliveryFailed(userId, orderId, status, ref));
      return;
    }
    case 'notification.low_stock': {
      // Phase 4 — emitted by markPaid.ts / the low-stock-sweep cron.
      const { userId, productId, variantId, productName, variantLabel, quantity, threshold } =
        event.payload;
      await createNotification(
        deps.prisma,
        lowStockNotification(userId, {
          productId,
          variantId,
          productName,
          variantLabel,
          quantity,
          threshold,
          detectedAt: event.payload.detectedAt,
        }),
      );
      await markLowStockNotified(deps.prisma, productId, variantId);
      return;
    }
    case 'notification.out_of_stock': {
      // Phase 4 — emitted by markPaid.ts / the low-stock-sweep cron.
      const { userId, productId, variantId, productName, variantLabel } = event.payload;
      await createNotification(
        deps.prisma,
        outOfStockNotification(userId, {
          productId,
          variantId,
          productName,
          variantLabel,
          detectedAt: event.payload.detectedAt,
        }),
      );
      await markLowStockNotified(deps.prisma, productId, variantId);
      return;
    }
    default: {
      // Exhaustive check — TS will yell if we add a new variant and forget it.
      const _exhaustive: never = event;
      void _exhaustive;
      throw new Error(`outbox: unknown event kind`);
    }
  }
}
