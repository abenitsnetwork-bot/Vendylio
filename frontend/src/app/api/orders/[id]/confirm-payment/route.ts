// POST /api/orders/[id]/confirm-payment — seller-side manual payment
// confirmation for Cash App / Zelle checkouts. Neither has a webhook API for
// peer-to-peer payments, so the buyer sends money outside Vendylio (Cash App
// QR scan, or a Zelle transfer to the seller's registered contact) and the
// SELLER confirms receipt here once they see it land in their own app.
//
// Deliberately restricted to `provider` being a manual method — a Stripe
// order (stripe_platform/stripe_connect) must NEVER be marked PAID by this
// route: that would let a seller bypass real payment verification and ship
// goods for an order nobody actually paid for. The Stripe webhook remains
// the only path that can mark a Stripe order PAID.
//
// Reuses applyOrderPaidEffects (lib/server/orders/markPaid.ts) — the exact
// same commission/stock/audit-trail/outbox side effects a real Stripe
// payment triggers, so a manually-confirmed order isn't a second-class
// citizen anywhere downstream (dashboard stats, customer directory, etc.).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { applyOrderPaidEffects } from '@/lib/server/orders/markPaid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const MANUAL_PROVIDERS = new Set(['cashapp_manual', 'zelle_manual']);

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

    if (!MANUAL_PROVIDERS.has(order.provider)) {
      return NextResponse.json(
        {
          error: 'NOT_A_MANUAL_PAYMENT',
          message: 'This order was not paid via Cash App or Zelle.',
        },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (order.status !== 'PENDING') {
      return NextResponse.json(
        {
          error: 'ORDER_NOT_PENDING',
          message: `Cannot confirm payment on an order that is ${order.status}.`,
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const paymentMethod = order.provider === 'cashapp_manual' ? 'cashapp' : 'zelle';
    const updated = await prisma.$transaction(
      async (tx) => {
        await applyOrderPaidEffects(tx, order, { paymentMethod });
        return tx.order.findUniqueOrThrow({ where: { id: order.id } });
      },
      { isolationLevel: 'Serializable' },
    );

    return NextResponse.json({ order: updated }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
