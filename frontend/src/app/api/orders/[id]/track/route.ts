// GET /api/orders/[id]/track — Phase 8, guest order-status read. Public by
// design (no requireAuth): a buyer has no account, so the unguessable Order
// id in their success-page URL IS their access token, same trust model as
// the pre-existing /s/[slug]/orders/[orderId]/success page. Deliberately a
// SEPARATE route + select from the seller-facing GET /api/orders/[id]
// (api/orders/[id]/route.ts) rather than a shared handler with an
// optionalAuth branch — that would risk a future edit accidentally leaking
// commissionAmount/netAmount (seller-financial fields) to a guest. This
// select only ever includes fields the buyer already knows from their own
// receipt.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const TRACK_SELECT = {
  id: true,
  status: true,
  amount: true,
  currency: true,
  lineItems: true,
  createdAt: true,
  paidAt: true,
  // Manual payment methods (Cash App/Zelle) have no webhook — the buyer
  // needs the seller's contact info on THIS page to actually pay, and
  // `provider` so the frontend knows to show it. Intentional exposure, not
  // a leak: a store only sets these fields for the express purpose of
  // showing them to a paying customer.
  provider: true,
  store: { select: { cashAppCashtag: true, zelleContact: true } },
} as const satisfies Prisma.OrderSelect;

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { id } = await ctx.params;
    const order = await prisma.order.findUnique({ where: { id }, select: TRACK_SELECT });
    if (!order) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'No such order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const review = await prisma.review.findUnique({
      where: { orderId: id },
      select: { id: true },
    });

    return NextResponse.json(
      { order, hasReview: Boolean(review) },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
