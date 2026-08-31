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
import { enqueueOutbox } from '@/lib/server/outbox';
import type { EmailOrderStatusEvent } from '@/lib/server/outbox/types';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

// Explicit transition table — EXPIRED/FAILED/REFUNDED aren't part of the
// seller-controlled lifecycle (they're managed by checkout/webhook/cron),
// and DELIVERED is terminal, so none of those appear as keys here.
//
// PENDING→CANCELLED is the one exception where a bare status flip is
// still correct: nothing has ever been charged or reserved at PENDING
// (stock decrements at PAID, not checkout — see api/orders/route.ts), so a
// seller clearing an abandoned/stale unpaid order has no money to reverse.
// This mirrors what cancelAbandonedOrder does automatically when the buyer
// lands on the checkout-failed page, and what the order-expiration cron
// does after ORDER_EXPIRATION_MINUTES either way — this just lets the
// seller do it immediately instead of waiting.
//
// CANCELLED is deliberately NOT a reachable target from any of the
// post-payment states below — it used to be, but that was a bare status
// flip that never touched money: a seller "cancelling" a paid Stripe order
// left the buyer's card charged with no way to reverse it from inside
// Vendylio. Ending a paid order early now always goes through
// POST /api/orders/[id]/refund, which actually reverses the charge (or
// records a manual refund for Cash App/Zelle) before setting REFUNDED.
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
  PENDING: ['CANCELLED'],
  PAID: ['PREPARING'],
  PREPARING: ['READY'],
  READY: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
};

// CANCELLED stays a syntactically valid value here (rather than rejected as
// VALIDATION_FAILED) purely so a caller still sending it gets the more
// informative 422 INVALID_STATUS_TRANSITION pointing at POST .../refund,
// instead of a generic 400.
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

    // Prompt #12 — the fulfillment card's event history (append-only).
    const deliveryEvents = delivery
      ? await prisma.deliveryEvent.findMany({
          where: { deliveryId: delivery.id },
          orderBy: { createdAt: 'asc' },
          select: { state: true, providerStatus: true, source: true, createdAt: true },
        })
      : [];

    return NextResponse.json(
      { order, statusEvents, delivery, deliveryEvents },
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

    // Phase 7 — customer status email for the milestones a buyer cares about.
    // PENDING→CANCELLED (an unpaid, abandoned order) deliberately emits
    // nothing: the buyer walked away from checkout, there's no order they're
    // tracking. Paid-order cancellation always goes through .../refund, which
    // sends its own email.
    const CUSTOMER_EMAIL_FOR: Record<string, EmailOrderStatusEvent['payload']['kind']> = {
      PREPARING: 'PREPARING',
      READY: 'READY',
      OUT_FOR_DELIVERY: 'ON_THE_WAY',
      DELIVERED: 'DELIVERED',
    };

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: order.id },
        data: { status: parsed.data.status },
      });
      await tx.orderStatusEvent.create({
        data: { orderId: order.id, status: parsed.data.status, actorType: 'SELLER' },
      });
      const emailKind = CUSTOMER_EMAIL_FOR[parsed.data.status];
      if (emailKind) {
        await enqueueOutbox(tx, {
          kind: 'email.order_status',
          payload: { orderId: order.id, kind: emailKind },
        });
      }
      return row;
    });

    return NextResponse.json({ order: updated }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
