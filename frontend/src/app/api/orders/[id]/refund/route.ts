// POST /api/orders/[id]/refund — seller-initiated full refund + cancellation.
//
// Replaces the old bare PATCH .../route.ts PAID/PREPARING/READY/
// OUT_FOR_DELIVERY -> CANCELLED transition, which only flipped the status
// column and never touched money: a seller "cancelling" a paid Stripe order
// left the buyer's card charged with no way to reverse it from inside
// Vendylio. This route is now the one way to end a paid order early:
//   - stripe_platform / stripe_connect: calls Stripe's real refund API
//     (reversing the Connect transfer too, for stripe_connect) BEFORE
//     touching the DB — a failed Stripe refund must never leave the order
//     looking refunded when it isn't.
//   - cashapp_manual / zelle_manual: no refund API exists for peer-to-peer
//     transfers, so this just records that the seller refunded the buyer
//     outside the app (same manual-trust model as confirm-payment/route.ts).
//
// Full refund only (MVP) — no partial-amount support yet.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { applyOrderRefundedEffects } from '@/lib/server/orders/refund';
import {
  getProvider,
  PaymentProviderUnconfiguredError,
} from '@/lib/server/payments/provider-singleton';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const STRIPE_PROVIDERS = new Set(['stripe_platform', 'stripe_connect']);
const REFUNDABLE_STATUSES = new Set([
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

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

    if (!REFUNDABLE_STATUSES.has(order.status)) {
      return NextResponse.json(
        {
          error: 'ORDER_NOT_REFUNDABLE',
          message: `Cannot refund an order that is ${order.status}.`,
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (STRIPE_PROVIDERS.has(order.provider)) {
      if (!order.providerChargeId) {
        return NextResponse.json(
          { error: 'REFUND_FAILED', message: 'This order has no charge to refund.' },
          { status: 500, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      try {
        const provider = getProvider();
        if (!provider.refund) throw new Error('Stripe provider does not implement refund()');
        await provider.refund({
          providerChargeId: order.providerChargeId,
          reverseTransfer: order.provider === 'stripe_connect',
        });
      } catch (err) {
        if (err instanceof PaymentProviderUnconfiguredError) {
          return NextResponse.json(
            { error: 'PAYMENT_PROVIDER_UNCONFIGURED', message: 'Payments are not configured.' },
            { status: 503, headers: { 'x-request-id': reqCtx.requestId } },
          );
        }
        return NextResponse.json(
          {
            error: 'REFUND_FAILED',
            message: err instanceof Error ? err.message : 'Stripe refund failed.',
          },
          { status: 502, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
    }

    const updated = await prisma.$transaction(
      async (tx) => {
        await applyOrderRefundedEffects(tx, order);
        return tx.order.findUniqueOrThrow({ where: { id: order.id } });
      },
      { isolationLevel: 'Serializable' },
    );

    return NextResponse.json({ order: updated }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
