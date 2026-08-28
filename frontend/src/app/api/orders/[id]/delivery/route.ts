// POST + PATCH /api/orders/[id]/delivery — Phase 5.
//
// Additive richer path alongside the generic PATCH /api/orders/[id] (see
// that file's TRANSITIONS comment): requesting delivery here creates a
// Delivery row (tracking info, provider correlation) and advances the Order
// through the same READY→OUT_FOR_DELIVERY→DELIVERED states. A seller who
// doesn't need delivery tracking can keep using the generic PATCH instead.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { getDeliveryProviderFor } from '@/lib/server/delivery';
import { formatQuantityWithUnit } from '@/lib/productUnits';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { store, order } = await findOwnedOrder(auth.user.sub, id);
    if (!order || !store) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'No such order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (order.status !== 'READY') {
      return NextResponse.json(
        {
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot request delivery for an order in ${order.status} status — it must be READY.`,
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // A PICKUP order has no courier involved — dispatching one here would be
    // a real (possibly billable) Uber Direct request for an order the buyer
    // is collecting in person. Use the generic PATCH /api/orders/[id]
    // (READY→DELIVERED) for pickup instead.
    if (order.fulfillmentMethod === 'PICKUP') {
      return NextResponse.json(
        {
          error: 'FULFILLMENT_METHOD_MISMATCH',
          message:
            'This order is a pickup — mark it delivered directly instead of requesting a courier.',
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // A FAILED delivery (courier cancelled/returned — see the Uber Direct
    // webhook's onFailed handler) is retryable: it already reverted
    // Order.status to READY specifically so this route stays reachable.
    // Anything else (REQUESTED, DELIVERED) still blocks a second request.
    const existing = await prisma.delivery.findUnique({ where: { orderId: order.id } });
    if (existing && existing.status !== 'FAILED') {
      return NextResponse.json(
        {
          error: 'DELIVERY_ALREADY_REQUESTED',
          message: 'Delivery was already requested for this order.',
        },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const provider = getDeliveryProviderFor(store.deliveryProvider);
    const lineItems = order.lineItems as unknown as {
      name: string;
      quantity: number;
      unit?: string;
    }[];
    let result;
    try {
      result = await provider.requestDelivery({
        orderId: order.id,
        storeId: store.id,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        deliveryAddress: order.deliveryAddress as Record<string, unknown> | null,
        pickupAddress: store.pickupAddress,
        storeName: store.name,
        storePhone: store.phone,
        amountCents: order.amount,
        // Uber Direct's manifest_items.quantity is a package count and must
        // be a whole number — sending a weight-based line item's raw
        // quantity (e.g. 5.3 lb) fails with a 400 whose body carries no
        // usable message (confirmed live). A weight/measure-sold item
        // (unit !== 'UNIT') is physically one package regardless of its
        // weight, so it always reports quantity 1 with the weight folded
        // into the name instead; a UNIT item keeps its real count, rounded
        // and floored at 1 as a defensive minimum.
        manifestItems: lineItems.map((item) => {
          const unit = item.unit ?? 'UNIT';
          return unit === 'UNIT'
            ? { name: item.name, quantity: Math.max(1, Math.round(item.quantity)) }
            : {
                name: `${item.name} (${formatQuantityWithUnit(item.quantity, unit)})`,
                quantity: 1,
              };
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown delivery provider error';
      return NextResponse.json(
        { error: 'DELIVERY_PROVIDER_UNCONFIGURED', message },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { delivery, order: updatedOrder } = await prisma.$transaction(async (tx) => {
      // Delivery.orderId is unique — a retry after FAILED reuses the same
      // row (upsert) rather than inserting a second one for this order.
      const createdDelivery = await tx.delivery.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          provider: store.deliveryProvider,
          providerDeliveryId: result.providerDeliveryId,
          status: result.status,
          ...(result.trackingUrl ? { trackingUrl: result.trackingUrl } : {}),
        },
        update: {
          provider: store.deliveryProvider,
          providerDeliveryId: result.providerDeliveryId,
          status: result.status,
          trackingUrl: result.trackingUrl ?? null,
          deliveredAt: null,
        },
      });
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: 'OUT_FOR_DELIVERY' },
      });
      await tx.orderStatusEvent.create({
        data: { orderId: order.id, status: 'OUT_FOR_DELIVERY', actorType: 'SELLER' },
      });
      return { delivery: createdDelivery, order: updated };
    });

    return NextResponse.json(
      { delivery, order: updatedOrder },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { order } = await findOwnedOrder(auth.user.sub, id);
    if (!order) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'No such order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const delivery = await prisma.delivery.findUnique({ where: { orderId: order.id } });
    if (!delivery) {
      return NextResponse.json(
        { error: 'DELIVERY_NOT_FOUND', message: 'No delivery was requested for this order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (order.status !== 'OUT_FOR_DELIVERY' || delivery.status === 'DELIVERED') {
      return NextResponse.json(
        {
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot mark this delivery delivered from order status ${order.status}.`,
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const provider = getDeliveryProviderFor(delivery.provider);
    try {
      await provider.markDelivered(delivery.providerDeliveryId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown delivery provider error';
      return NextResponse.json(
        { error: 'DELIVERY_PROVIDER_UNCONFIGURED', message },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { updatedDelivery, updatedOrder } = await prisma.$transaction(async (tx) => {
      const deliveredAt = new Date();
      const nextDelivery = await tx.delivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', deliveredAt },
      });
      const nextOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: 'DELIVERED' },
      });
      await tx.orderStatusEvent.create({
        data: { orderId: order.id, status: 'DELIVERED', actorType: 'SELLER' },
      });
      return { updatedDelivery: nextDelivery, updatedOrder: nextOrder };
    });

    return NextResponse.json(
      { delivery: updatedDelivery, order: updatedOrder },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
