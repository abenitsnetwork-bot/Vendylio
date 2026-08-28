// Cancels a PENDING order the moment the buyer lands on the checkout
// "failed"/cancelled page — Stripe's own redirect there is a reliable
// "the buyer gave up" signal, so there's no reason to wait for the
// order-expiration cron (30 min later) to do the same thing. Nothing was
// ever charged or reserved at PENDING (stock decrements at PAID, not
// checkout), so this is a plain, safe status flip — same terminal value
// the seller's own "Cancel Order" action produces for a PENDING order.
//
// The status='PENDING' WHERE-guard (matching expire.ts's own pattern)
// makes this race-free against a webhook that completes the payment in a
// parallel tab right as the buyer also lands on this page from a stale
// back-navigation — whichever write lands first wins, the other is a
// silent no-op.
import 'server-only';
import type { PrismaClient } from '@prisma/client';

export async function cancelAbandonedOrder(
  prisma: PrismaClient,
  orderId: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.order.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (result.count > 0) {
      await tx.orderStatusEvent.create({
        data: { orderId, status: 'CANCELLED', actorType: 'SYSTEM' },
      });
    }
    return result.count > 0;
  });
}
