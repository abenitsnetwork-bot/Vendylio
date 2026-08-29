// POST /api/orders/track/[token]/review — Phase 7 (moved from
// /api/orders/[id]/review). Guest-submitted, no account: the high-entropy
// trackingToken in the URL is the buyer's credential (§29). Gated to
// status === 'DELIVERED' and to one review per order (Review.orderId unique).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ token: string }>;
}

const Body = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(1000).optional(),
});

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const { token } = await ctx.params;
    const order = await prisma.order.findUnique({ where: { trackingToken: token } });
    if (!order) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'No such order.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (order.status !== 'DELIVERED') {
      return NextResponse.json(
        {
          error: 'REVIEW_NOT_ALLOWED',
          message: 'Reviews can only be left once an order has been delivered.',
        },
        { status: 422, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const existing = await prisma.review.findUnique({ where: { orderId: order.id } });
    if (existing) {
      return NextResponse.json(
        { error: 'REVIEW_ALREADY_EXISTS', message: 'This order has already been reviewed.' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const review = await prisma.review.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        rating: parsed.data.rating,
        ...(parsed.data.text ? { text: parsed.data.text } : {}),
      },
    });

    return NextResponse.json(
      { review },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
