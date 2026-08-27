// POST /api/products/[id]/variants — Phase 7. Adds one independent variant
// option (e.g. "Size: Large", "1kg bag") to one of the caller's own
// products. Ownership via findOwnedProduct — same 404-not-403 pattern as
// api/products/[id]/route.ts.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedProduct } from '@/lib/server/products/ownership';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { isValidQuantityForUnit, roundQuantity } from '@/lib/quantity';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const Body = z.object({
  name: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(60),
  priceDeltaCents: z.number().int().default(0),
  // Whole-number-for-UNIT is checked below against the parent product's
  // unit — a variant has no unit of its own, it inherits the product's.
  quantity: z.number().min(0).default(0),
});

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { product } = await findOwnedProduct(auth.user.sub, id);
    if (!product) {
      return NextResponse.json(
        { error: 'PRODUCT_NOT_FOUND', message: 'No such product.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (!isValidQuantityForUnit(parsed.data.quantity, product.unit)) {
      return NextResponse.json(
        {
          error: 'VALIDATION_FAILED',
          message: 'Quantity must be a whole number for a per-item product.',
        },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        ...parsed.data,
        quantity: roundQuantity(parsed.data.quantity),
      },
    });

    return NextResponse.json(
      { variant },
      { status: 201, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
