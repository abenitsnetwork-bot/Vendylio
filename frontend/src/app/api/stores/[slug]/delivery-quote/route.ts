// POST /api/stores/[slug]/delivery-quote — public, guest-accessible checkout
// preview of every fulfillment option for THIS store, so the checkout page can
// show real fees + ETAs before the buyer pays.
//
// Since Prompt #12 this returns an ARRAY of options (one per enabled +
// serviceable method) with persisted `quoteId`s. `POST /api/orders` then
// re-validates / re-quotes the selected one — the number shown here is what
// gets charged (barring a courier's price moving in the seconds between).
//
// Partial failure is tolerated: a slow / erroring provider simply drops out.
// If no delivery method can service the address, PICKUP is still offered and
// `deliveryUnavailable` / `notServiceable` drive the checkout copy.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { verifyCsrf } from '@/lib/server/auth';
import { createQuote } from '@/lib/server/fulfillment/service';
import { readFulfillmentConfig } from '@/lib/server/fulfillment/config';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ slug: string }>;
}

const Body = z.object({
  deliveryAddress: z.record(z.string(), z.unknown()),
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
      select: {
        id: true,
        phone: true,
        pickupAddress: true,
        deliveryProvider: true,
        deliveryFeeCents: true,
        fulfillmentConfig: true,
      },
    });
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'No such store.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const config = readFulfillmentConfig(store);
    const result = await createQuote(prisma, {
      storeId: store.id,
      config,
      pickupAddress: store.pickupAddress,
      pickupPhone: store.phone,
      dropoffAddress: parsed.data.deliveryAddress,
      dropoffPhone: null,
      subtotalCents: parsed.data.amountCents,
      currency: 'USD',
    });

    return NextResponse.json(result, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
