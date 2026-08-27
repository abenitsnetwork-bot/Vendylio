// Shared "an order just got refunded" side effects — status flip, audit
// trail, stock restoration, buyer notification. Mirrors markPaid.ts's
// structure so a refund undoes exactly what payment did. The caller is
// responsible for actually reversing the money (calling the payment
// provider's refund API, or trusting the seller's word for a manual
// Cash App/Zelle payment) BEFORE calling this — this function only records
// the outcome, it never decides whether the refund succeeded.
import 'server-only';
import { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';
import { enqueueOutbox } from '@/lib/server/outbox';
import { roundQuantity } from '@/lib/quantity';

interface OrderLineItem {
  productId: string;
  quantity: number;
  variantId?: string;
}

export interface OrderForRefundEffects {
  id: string;
  amount: number;
  currency: string;
  lineItems: Prisma.JsonValue;
  customerEmail: string | null;
}

export async function applyOrderRefundedEffects(
  tx: PrismaTransactionClient,
  order: OrderForRefundEffects,
): Promise<void> {
  await tx.order.update({
    where: { id: order.id },
    data: { status: 'REFUNDED' },
  });

  await tx.orderStatusEvent.create({
    data: { orderId: order.id, status: 'REFUNDED', actorType: 'SELLER' },
  });

  // Restock — the mirror image of markPaid's decrement. No floor needed
  // here (unlike the decrement's floor at 0): adding back can't go negative.
  const lineItems = order.lineItems as unknown as OrderLineItem[];
  for (const item of lineItems) {
    if (item.variantId) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { quantity: true },
      });
      if (!variant) continue;
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { quantity: roundQuantity(variant.quantity + item.quantity) },
      });
      continue;
    }
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { quantity: true },
    });
    if (!product) continue;
    await tx.product.update({
      where: { id: item.productId },
      data: { quantity: roundQuantity(product.quantity + item.quantity) },
    });
  }

  if (order.customerEmail) {
    await enqueueOutbox(tx, {
      kind: 'email.order_refunded',
      payload: {
        to: order.customerEmail,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
    });
  }
}
