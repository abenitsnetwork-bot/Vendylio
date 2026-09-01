// POST + PATCH /api/orders/[id]/delivery — seller-facing delivery controls.
//
// Since Prompt #12 (the fulfillment engine) a `Delivery` row already exists in
// `state: PENDING` for every paid delivery order (markPaid.ts), and the
// `fulfillment-tick` cron dispatches courier deliveries automatically once the
// seller marks the order READY. This route is the seller's manual lever:
//
//   POST  — "Request delivery" / "Retry": dispatch the PENDING (or FAILED)
//           delivery to the courier NOW instead of waiting for the next cron
//           tick. Goes through `fulfillmentService.createFulfillment`, which
//           reconciles rather than re-creating if an external delivery already
//           exists.
//   PATCH — "Mark delivered": only for MERCHANT (self) delivery — a courier
//           delivery completes from its own webhook, never a seller click.
//
// Every state change funnels through the fulfillment service — this route
// never writes Delivery.state / Order.status itself.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { createFulfillment, updateFulfillment } from '@/lib/server/fulfillment/service';
import { isCourierProvider, type ProviderType } from '@/lib/server/fulfillment/types';
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

    if (order.fulfillmentMethod === 'PICKUP') {
      return NextResponse.json(
        {
          error: 'FULFILLMENT_METHOD_MISMATCH',
          message: 'This order is a pickup — mark it picked up from the order page instead.',
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
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

    const delivery = await prisma.delivery.findUnique({
      where: { orderId: order.id },
      select: { id: true, state: true },
    });
    if (!delivery) {
      return NextResponse.json(
        {
          error: 'DELIVERY_NOT_FOUND',
          message:
            'No fulfillment record for this order. This can happen for orders paid before the engine shipped — contact support.',
        },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // A REQUESTED / CONFIRMED / … delivery is already in flight. FAILED is
    // retryable; PENDING is the normal "dispatch me now" case.
    if (delivery.state !== 'PENDING' && delivery.state !== 'FAILED') {
      return NextResponse.json(
        {
          error: 'DELIVERY_ALREADY_REQUESTED',
          message: 'Delivery is already in progress for this order.',
        },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const result = await createFulfillment(prisma, delivery.id, { actor: 'MERCHANT', force: true });

    // `error` is set only when this invocation's courier request failed —
    // surface a stable code (Prompt #13 Y4) whether the delivery went FAILED
    // (attempt cap) or stayed PENDING (will be retried by the cron), so the
    // merchant never sees a silent 201 for a retry that didn't dispatch.
    if (result.error) {
      return NextResponse.json(
        { error: result.code ?? 'DELIVERY_CREATION_FAILED', message: result.error },
        { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.delivery.findUnique({ where: { id: delivery.id } });
    return NextResponse.json(
      { delivery: updated },
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

    const delivery = await prisma.delivery.findUnique({
      where: { orderId: order.id },
      select: { id: true, state: true, providerType: true },
    });
    if (!delivery) {
      return NextResponse.json(
        { error: 'DELIVERY_NOT_FOUND', message: 'No delivery was requested for this order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (delivery.providerType && isCourierProvider(delivery.providerType as ProviderType)) {
      return NextResponse.json(
        {
          error: 'COURIER_COMPLETES_AUTOMATICALLY',
          message:
            'This delivery is handled by a courier and completes automatically once the courier confirms drop-off.',
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (order.status !== 'OUT_FOR_DELIVERY' || delivery.state === 'DELIVERED') {
      return NextResponse.json(
        {
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot mark this delivery delivered from order status ${order.status}.`,
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await updateFulfillment(prisma, delivery.id, 'DELIVERED', 'MERCHANT');

    const updated = await prisma.delivery.findUnique({ where: { id: delivery.id } });
    return NextResponse.json(
      { delivery: updated },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
