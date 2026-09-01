// ORD-01 (Prompt #15) — nudge the store owner about a paid order they haven't
// moved forward. A paid order that sits at PAID/PREPARING for
// `ORDER_NUDGE_HOURS` gets ONE reminder (in-app + email), then never again:
// `createNotification`'s dedupeKey (`order-unfulfilled:<id>`) is the hard gate,
// and this sweep also pre-filters orders that already carry the notification so
// it doesn't even re-enqueue.
//
// Deliberately does NOT touch order state — it only enqueues outbox rows.
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { enqueueOutbox } from '@/lib/server/outbox';

const HOUR_MS = 60 * 60 * 1000;

/** Hours a paid order may sit untouched before the seller is nudged. */
export const NUDGE_HOURS = Math.max(1, Number(process.env.ORDER_NUDGE_HOURS ?? 6));
/** Don't nudge about orders older than this (avoids a first-deploy backlog blast). */
export const NUDGE_MAX_AGE_HOURS = Math.max(
  NUDGE_HOURS + 1,
  Number(process.env.ORDER_NUDGE_MAX_AGE_HOURS ?? 96),
);

/** Statuses that mean "the seller still owes the customer an action". */
const STALLED_STATUSES = ['PAID', 'PREPARING'] as const;

export async function nudgeUnfulfilledOrders(
  deps: { prisma: PrismaClient },
  batchSize = 50,
): Promise<{ scanned: number; nudged: number }> {
  const now = Date.now();
  const staleBefore = new Date(now - NUDGE_HOURS * HOUR_MS);
  const notOlderThan = new Date(now - NUDGE_MAX_AGE_HOURS * HOUR_MS);

  const candidates = await deps.prisma.order.findMany({
    where: {
      status: { in: [...STALLED_STATUSES] },
      paidAt: { lte: staleBefore, gte: notOlderThan },
    },
    orderBy: { paidAt: 'asc' },
    take: batchSize,
    select: {
      id: true,
      paidAt: true,
      store: {
        select: { organization: { select: { ownerId: true } } },
      },
    },
  });

  if (candidates.length === 0) return { scanned: 0, nudged: 0 };

  // Skip orders that already carry the once-per-order nudge notification.
  const dedupeKeys = candidates.map((o) => `order-unfulfilled:${o.id}`);
  const already = await deps.prisma.notification.findMany({
    where: { dedupeKey: { in: dedupeKeys } },
    select: { dedupeKey: true },
  });
  const alreadyNudged = new Set(already.map((n) => n.dedupeKey));

  let nudged = 0;
  for (const order of candidates) {
    if (alreadyNudged.has(`order-unfulfilled:${order.id}`)) continue;
    const ownerId = order.store?.organization?.ownerId;
    if (!ownerId || !order.paidAt) continue;

    const hoursWaiting = Math.max(1, Math.round((now - order.paidAt.getTime()) / HOUR_MS));

    // The in-app + email pair commit together so a crash can't leave one
    // half-sent (the dispatcher then dedupes the notification anyway).
    await deps.prisma.$transaction(async (tx) => {
      await enqueueOutbox(tx, {
        kind: 'notification.order_unfulfilled',
        payload: { userId: ownerId, orderId: order.id, hoursWaiting },
      });
      await enqueueOutbox(tx, {
        kind: 'email.order_unfulfilled',
        payload: { orderId: order.id, hoursWaiting },
      });
    });
    nudged += 1;
  }

  return { scanned: candidates.length, nudged };
}
