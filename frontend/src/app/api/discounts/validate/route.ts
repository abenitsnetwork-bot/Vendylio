// GET /api/discounts/validate?slug=<store>&code=<code>&subtotal=<cents>
//
// Public, unauthenticated — the checkout's "Apply" button calls this for
// instant feedback before the order POST. Authoritative pricing still
// happens in POST /api/orders (this can go stale between the click and
// submit; the order route re-checks and 400s a code that's since expired).
//
// Enumeration note: a probe learns "does store X have code Y". Acceptable
// for FREE_DELIVERY codes, which sellers hand out publicly anyway; the
// specific failure reason is returned so a seller can debug their own code.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { evaluateDiscount, normalizeDiscountCode } from '@/lib/server/discounts/evaluate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const REASON_MESSAGE: Record<string, string> = {
  NOT_FOUND: "That code doesn't exist for this store.",
  OFF: 'That code is not currently active.',
  SCHEDULED: 'That code is not active yet.',
  EXPIRED: 'That code has expired.',
  EXHAUSTED: 'That code has reached its usage limit.',
  MIN_SUBTOTAL: 'Your cart is below this code’s minimum.',
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const url = req.nextUrl;
    const slug = (url.searchParams.get('slug') ?? '').trim();
    const rawCode = (url.searchParams.get('code') ?? '').trim();
    const subtotalCents = Math.max(0, Math.trunc(Number(url.searchParams.get('subtotal') ?? '0')));

    if (!slug || !rawCode) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'slug and code are required.' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const store = await prisma.store.findFirst({
      where: { slug, published: true },
      select: { id: true, deliveryFeeCents: true },
    });
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'No such store.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const code = normalizeDiscountCode(rawCode);
    const discount = await prisma.discount.findUnique({
      where: { storeId_code: { storeId: store.id, code } },
      select: {
        kind: true,
        active: true,
        startsAt: true,
        endsAt: true,
        minSubtotalCents: true,
        maxRedemptions: true,
        redemptionCount: true,
      },
    });

    // Preview uses the store's flat fee — a live Uber Direct quote isn't
    // known until the buyer's address is in; the order route recomputes.
    const result = evaluateDiscount(discount, {
      subtotalCents,
      deliveryFeeCents: store.deliveryFeeCents,
    });

    return NextResponse.json(
      {
        valid: result.ok,
        code,
        kind: 'FREE_DELIVERY',
        ...(result.ok
          ? { message: 'Free delivery applied.' }
          : { reason: result.reason, message: REASON_MESSAGE[result.reason ?? 'NOT_FOUND'] }),
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
