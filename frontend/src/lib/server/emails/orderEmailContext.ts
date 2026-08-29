// Phase 7 — turn an order id into the normalized OrderEmailContext the
// transactional templates need. One indexed lookup, run out-of-band by the
// outbox dispatcher (never on the order's request path). Returns null when
// the order has no customer email — the caller then skips the send.
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { formatOrderNumber } from '@/lib/orderNumber';
import { siteOrigin } from '@/lib/seo';
import type { OrderEmailContext, OrderEmailItem } from './orderEmails';

interface RawLineItem {
  name?: string;
  quantity?: number;
  priceCents?: number;
  unit?: string;
}

export interface ResolvedOrderEmail {
  to: string;
  context: OrderEmailContext;
}

export async function resolveOrderEmailContext(
  prisma: PrismaClient,
  orderId: string,
): Promise<ResolvedOrderEmail | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      trackingToken: true,
      customerEmail: true,
      customerName: true,
      fulfillmentMethod: true,
      amount: true,
      currency: true,
      lineItems: true,
      store: { select: { name: true, slug: true, phone: true } },
    },
  });
  if (!order || !order.customerEmail || !order.store) return null;

  const origin = siteOrigin();
  const items: OrderEmailItem[] = (order.lineItems as unknown as RawLineItem[]).map((li) => ({
    name: li.name ?? 'Item',
    quantity: li.quantity ?? 1,
    unitLabel: li.unit,
    lineTotalCents: Math.round((li.priceCents ?? 0) * (li.quantity ?? 1)),
  }));

  const context: OrderEmailContext = {
    storeName: order.store.name,
    orderReference: formatOrderNumber(order.orderNumber),
    trackingUrl: `${origin}/s/${order.store.slug}/orders/${order.trackingToken}/success`,
    customerName: order.customerName,
    fulfillmentMethod: order.fulfillmentMethod === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
    items,
    totalCents: order.amount,
    currency: order.currency,
    storePhone: order.store.phone,
    storeUrl: `${origin}/s/${order.store.slug}`,
  };

  return { to: order.customerEmail, context };
}
