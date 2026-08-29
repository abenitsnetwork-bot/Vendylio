// GET /api/orders/track/[token] — Phase 7, the guest order-status read.
//
// Public by design: a guest buyer has no account, so the high-entropy
// `trackingToken` in their success-page URL / email link IS their access
// credential (§29 — never the cuid id, never the sequential order number).
// An unknown token is a flat 404 that never reveals whether some other order
// exists (§142/§160).
//
// The response is a CUSTOMER VIEW MODEL (lib/server/orders/customerView.ts) —
// only the fields the tracking UI needs, all already known to the buyer from
// their own receipt. It deliberately never serializes the Order row, so a
// future column (commissionAmount, netAmount, internal notes…) can't leak
// here (§31/§136/§191/§193).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { formatOrderNumber } from '@/lib/orderNumber';
import {
  mapOrderStatusForCustomer,
  buildOrderTimeline,
  isClosedStatus,
  type FulfillmentMethod,
} from '@/lib/server/orders/customerView';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ token: string }>;
}

const TRACK_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  currency: true,
  subtotalCents: true,
  deliveryFeeCents: true,
  taxCents: true,
  amount: true,
  lineItems: true,
  createdAt: true,
  paidAt: true,
  fulfillmentMethod: true,
  deliveryAddress: true,
  // Manual payment methods (Cash App/Zelle) have no webhook — the buyer needs
  // the seller's contact info on THIS page to actually pay, and `provider` so
  // the frontend knows to show it. Intentional exposure, not a leak.
  provider: true,
  store: {
    select: {
      name: true,
      slug: true,
      phone: true,
      pickupAddress: true,
      cashAppCashtag: true,
      zelleContact: true,
    },
  },
  statusEvents: {
    select: { status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  delivery: { select: { status: true, trackingUrl: true } },
} as const satisfies Prisma.OrderSelect;

interface RawLineItem {
  name?: string;
  quantity?: number;
  priceCents?: number;
  unit?: string;
  variantLabel?: string;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { token } = await ctx.params;

    // Guard against a probe with an obviously-not-a-token value before hitting
    // the DB; the unique lookup below is the real check.
    if (!token || token.length < 16 || token.length > 64) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: "We couldn't find this order." },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const order = await prisma.order.findUnique({
      where: { trackingToken: token },
      select: TRACK_SELECT,
    });
    if (!order || !order.store) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: "We couldn't find this order." },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const review = await prisma.review.findUnique({
      where: { orderId: order.id },
      select: { id: true },
    });

    const fulfillmentMethod: FulfillmentMethod =
      order.fulfillmentMethod === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
    const items = (order.lineItems as unknown as RawLineItem[]).map((li) => ({
      name: li.name ?? 'Item',
      quantity: li.quantity ?? 1,
      unit: li.unit ?? 'UNIT',
      variantLabel: li.variantLabel ?? null,
      lineTotalCents: Math.round((li.priceCents ?? 0) * (li.quantity ?? 1)),
    }));

    const isManualPaymentPending =
      order.status === 'PENDING' &&
      (order.provider === 'cashapp_manual' || order.provider === 'zelle_manual');

    const view = {
      reference: formatOrderNumber(order.orderNumber),
      placedAt: order.createdAt.toISOString(),
      paidAt: order.paidAt ? order.paidAt.toISOString() : null,
      fulfillmentMethod,
      status: mapOrderStatusForCustomer(order.status, fulfillmentMethod),
      closed: isClosedStatus(order.status),
      isManualPaymentPending,
      provider: order.provider,
      items,
      totals: {
        subtotalCents: order.subtotalCents,
        deliveryFeeCents: order.deliveryFeeCents,
        taxCents: order.taxCents,
        totalCents: order.amount,
        currency: order.currency,
      },
      deliveryAddress: (order.deliveryAddress as Prisma.JsonValue) ?? null,
      delivery: order.delivery
        ? { status: order.delivery.status, trackingUrl: order.delivery.trackingUrl }
        : null,
      timeline: buildOrderTimeline(order.statusEvents, fulfillmentMethod),
      store: {
        name: order.store.name,
        slug: order.store.slug,
        phone: order.store.phone,
        pickupAddress: order.store.pickupAddress,
        cashAppCashtag: order.store.cashAppCashtag,
        zelleContact: order.store.zelleContact,
      },
    };

    return NextResponse.json(
      { order: view, hasReview: Boolean(review) },
      { headers: { 'x-request-id': reqCtx.requestId, 'x-robots-tag': 'noindex' } },
    );
  });
}
