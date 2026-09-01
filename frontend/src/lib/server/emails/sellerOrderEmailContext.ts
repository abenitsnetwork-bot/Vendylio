// Prompt #15 — turn an order id into the data the seller operational emails
// (NOTIF-01 new-order, ORD-01 nudge) need: the STORE OWNER's address, their
// notification preferences, and a normalised order summary. One indexed lookup,
// run out-of-band by the outbox dispatcher. Returns null when there is no
// owner / no owner email to send to.
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { formatOrderNumber } from '@/lib/orderNumber';
import { siteOrigin } from '@/lib/seo';
import type { NotificationPrefs } from '@/lib/server/notifications/prefs-merge';
import type { SellerOrderEmailContext, SellerOrderEmailItem } from './sellerEmails';

interface RawLineItem {
  name?: string;
  quantity?: number;
  priceCents?: number;
  unit?: string;
}

export interface ResolvedSellerOrderEmail {
  to: string;
  prefs: NotificationPrefs | null;
  context: SellerOrderEmailContext;
}

function formatAddress(addr: unknown): string | null {
  if (!addr || typeof addr !== 'object') return null;
  const a = addr as Record<string, unknown>;
  const parts = ['street', 'city', 'state', 'zip']
    .map((k) => (typeof a[k] === 'string' ? (a[k] as string).trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export async function resolveSellerOrderEmailContext(
  prisma: PrismaClient,
  orderId: string,
): Promise<ResolvedSellerOrderEmail | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      customerPhone: true,
      fulfillmentMethod: true,
      deliveryAddress: true,
      amount: true,
      currency: true,
      lineItems: true,
      store: {
        select: {
          name: true,
          organization: {
            select: { owner: { select: { id: true, email: true } } },
          },
        },
      },
    },
  });

  const owner = order?.store?.organization?.owner;
  if (!order || !owner || !owner.email) return null;

  const prefsRow = await prisma.notificationPreferences.findUnique({
    where: { userId: owner.id },
    select: { prefs: true },
  });

  const items: SellerOrderEmailItem[] = (order.lineItems as unknown as RawLineItem[]).map((li) => ({
    name: li.name ?? 'Item',
    quantity: li.quantity ?? 1,
    unitLabel: li.unit,
    lineTotalCents: Math.round((li.priceCents ?? 0) * (li.quantity ?? 1)),
  }));

  const context: SellerOrderEmailContext = {
    storeName: order.store!.name,
    orderReference: formatOrderNumber(order.orderNumber),
    dashboardUrl: `${siteOrigin()}/dashboard/orders/${order.id}`,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    fulfillmentMethod: order.fulfillmentMethod === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
    deliveryAddress: formatAddress(order.deliveryAddress),
    items,
    totalCents: order.amount,
    currency: order.currency,
  };

  return {
    to: owner.email,
    prefs: (prefsRow?.prefs as NotificationPrefs | null) ?? null,
    context,
  };
}
