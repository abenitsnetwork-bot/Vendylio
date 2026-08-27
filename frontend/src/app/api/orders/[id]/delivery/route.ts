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

    const existing = await prisma.delivery.findUnique({ where: { orderId: order.id } });
    if (existing) {
      return NextResponse.json(
        {
          error: 'DELIVERY_ALREADY_REQUESTED',
          message: 'Delivery was already requested for this order.',
        },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const provider = getDeliveryProviderFor(store.deliveryProvider);
    const lineItems = order.lineItems as unknown as { name: string; quantity: number }[];
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
        manifestItems: lineItems.map((item) => ({ name: item.name, quantity: item.quantity })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown delivery provider error';
      return NextResponse.json(
        { error: 'DELIVERY_PROVIDER_UNCONFIGURED', message },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { delivery, order: updatedOrder } = await prisma.$transaction(async (tx) => {
      const createdDelivery = await tx.delivery.create({
        data: {
          orderId: order.id,
          provider: store.deliveryProvider,
          providerDeliveryId: result.providerDeliveryId,
          status: result.status,
          ...(result.trackingUrl ? { trackingUrl: result.trackingUrl } : {}),
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
