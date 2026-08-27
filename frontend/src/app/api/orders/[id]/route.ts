// GET + PATCH /api/orders/[id] — Phase 4 order detail + lifecycle.
// Ownership via order.storeId === callerStore.id, same 404-not-403 pattern
// as findOwnedProduct in api/products/[id]/route.ts — a seller probing
// another seller's order id gets ORDER_NOT_FOUND, never a 403 that would
// confirm the id exists.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

// Explicit transition table — PENDING/EXPIRED/FAILED/REFUNDED aren't part of
// the seller-controlled lifecycle (they're managed by checkout/webhook/cron),
// and DELIVERED/CANCELLED are terminal, so none of those appear as keys here.
//
// Phase 5 note: READY→OUT_FOR_DELIVERY and OUT_FOR_DELIVERY→DELIVERED stay
// reachable here too (not removed in favor of the new
// api/orders/[id]/delivery/route.ts) — a seller doing simple pickup with no
// delivery concept at all still needs a way to move an order through these
// states without being forced to "request delivery" first. The delivery
// sub-resource is an additive, richer path (creates a Delivery row with
// tracking info) for sellers who want it; this generic PATCH is the
// always-available fallback.
//
// READY→DELIVERED (direct, skipping OUT_FOR_DELIVERY) is for
// Order.fulfillmentMethod === 'PICKUP' — nothing is ever "out for delivery"
// when the buyer collects in person, so the seller just marks it handed
// over. Nothing stops a DELIVERY order from using this same direct jump too
// (the transition table isn't fulfillmentMethod-aware) — the dashboard UI
// only offers it for PICKUP orders, but the API itself doesn't forbid it for
// a seller who genuinely handed a delivery order over without a courier.
const TRANSITIONS: Record<string, readonly string[]> = {
  PAID: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
};

const PatchBody = z.object({
  status: z.enum(['PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
});

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
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

    const [statusEvents, delivery] = await Promise.all([
      prisma.orderStatusEvent.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.delivery.findUnique({ where: { orderId: order.id } }),
    ]);

    return NextResponse.json(
      { order, statusEvents, delivery },
      { headers: { 'x-request-id': reqCtx.requestId } },
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

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const allowedNext = TRANSITIONS[order.status] ?? [];
    if (!allowedNext.includes(parsed.data.status)) {
      return NextResponse.json(
        {
          error: 'INVALID_STATUS_TRANSITION',
          message: `Cannot move an order from ${order.status} to ${parsed.data.status}.`,
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: order.id },
        data: { status: parsed.data.status },
      });
      await tx.orderStatusEvent.create({
        data: { orderId: order.id, status: parsed.data.status, actorType: 'SELLER' },
      });
      return row;
    });

    return NextResponse.json({ order: updated }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
