// POST /api/stores/[slug]/delivery-quote — public, guest-accessible preview
// of what Delivery will cost at THIS store, so the checkout page can show a
// real number before the buyer submits payment.
//
// Uses the exact same getUberDirectDeliveryFeeCents() helper the checkout
// route (POST /api/orders) calls to compute the actual charge — same
// inputs in, same fee out, so the preview shown here never drifts from
// what gets charged (barring Uber's price moving between the two calls,
// typically seconds apart).
//
// `isEstimate: true` tells the frontend the number is the store's flat
// Store.deliveryFeeCents, not a live Uber Direct quote — either because the
// store uses self_manual, or because a live quote couldn't be fetched (bad
// address, Uber API error, not configured). Never fails the request for
// that — a missed live quote just falls back silently, same as checkout.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { verifyCsrf } from '@/lib/server/auth';
import { getUberDirectDeliveryFeeCents } from '@/lib/server/delivery/uber-direct';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ slug: string }>;
}

const Body = z.object({
  deliveryAddress: z.record(z.string(), z.unknown()),
  // Cart subtotal — Uber's quote can factor package value into the fee
  // (insurance/liability sizing), so this preview passes the same amount
  // the real checkout charge will use rather than a placeholder.
  amountCents: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { slug } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const store = await prisma.store.findFirst({
      where: { slug, published: true },
      select: { deliveryProvider: true, deliveryFeeCents: true, pickupAddress: true },
    });
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'No such store.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (store.deliveryProvider !== 'uber_direct') {
      return NextResponse.json(
        { feeCents: store.deliveryFeeCents, isEstimate: true },
        { headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const quotedFee = await getUberDirectDeliveryFeeCents({
      pickupAddress: store.pickupAddress,
      deliveryAddress: parsed.data.deliveryAddress,
      amountCents: parsed.data.amountCents,
    });

    return NextResponse.json(
      quotedFee === null
        ? { feeCents: store.deliveryFeeCents, isEstimate: true }
        : { feeCents: quotedFee, isEstimate: false },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
