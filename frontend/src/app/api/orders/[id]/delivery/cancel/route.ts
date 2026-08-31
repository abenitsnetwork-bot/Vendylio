// POST /api/orders/[id]/delivery/cancel — seller cancels an in-flight delivery.
//
// Goes through `fulfillmentService.cancelFulfillment`, which asks the courier
// (Uber / DoorDash) to cancel first and only moves the Delivery to CANCELLED
// if the provider agrees — a courier that already has a Dasher assigned may
// refuse, in which case this returns 409 DELIVERY_CANCEL_NOT_ALLOWED and the
// seller handles it out of band. A MERCHANT / self delivery always cancels.
//
// This does NOT touch payment: cancelling a delivery never marks a paid order
// unpaid (spec §171). Refunds stay a separate, explicit seller action.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { cancelFulfillment } from '@/lib/server/fulfillment/service';
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
    const { order } = await findOwnedOrder(auth.user.sub, id);
    if (!order) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'No such order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const delivery = await prisma.delivery.findUnique({
      where: { orderId: order.id },
      select: { id: true },
    });
    if (!delivery) {
      return NextResponse.json(
        { error: 'DELIVERY_NOT_FOUND', message: 'No delivery to cancel for this order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    const result = await cancelFulfillment(prisma, delivery.id, {
      actor: 'MERCHANT',
      ...(typeof body.reason === 'string' && body.reason.trim()
        ? { reason: body.reason.trim().slice(0, 200) }
        : {}),
    });

    if (!result.cancelled) {
      return NextResponse.json(
        {
          error: 'DELIVERY_CANCEL_NOT_ALLOWED',
          message: result.reason ?? 'This delivery cannot be cancelled.',
        },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.delivery.findUnique({ where: { id: delivery.id } });
    return NextResponse.json(
      { delivery: updated },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
