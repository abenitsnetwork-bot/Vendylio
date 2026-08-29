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
import { applyStockChange } from '@/lib/server/inventory/adjust';

interface OrderLineItem {
  productId: string;
  quantity: number;
  variantId?: string;
}

export interface OrderForRefundEffects {
  id: string;
  storeId: string;
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

  // Restock — the mirror image of markPaid's decrement, and like it goes
  // through applyStockChange so a REFUND_RESTOCK row lands in the ledger.
  // No floor needed here: adding back can't go negative.
  const lineItems = order.lineItems as unknown as OrderLineItem[];
  for (const item of lineItems) {
    const exists = item.variantId
      ? await tx.productVariant.findUnique({ where: { id: item.variantId }, select: { id: true } })
      : await tx.product.findUnique({ where: { id: item.productId }, select: { id: true } });
    if (!exists) continue;

    await applyStockChange(tx, {
      storeId: order.storeId,
      productId: item.productId,
      variantId: item.variantId ?? null,
      delta: item.quantity,
      reason: 'REFUND_RESTOCK',
      actorType: 'SELLER',
      orderId: order.id,
    });
  }

  if (order.customerEmail) {
    // Phase 7 — the dispatcher renders the branded template + resolves the
    // recipient from the order row.
    await enqueueOutbox(tx, {
      kind: 'email.order_refunded',
      payload: { orderId: order.id },
    });
  }
}
