// PATCH + DELETE /api/products/[id]/variants/[variantId] — Phase 7. Edit or
// remove one variant option. Ownership is two-layered: the product must
// belong to the caller's store (findOwnedProduct), AND the variant must
// belong to that exact product (never trust the variantId alone) — a 404
// (not 403) on either mismatch, same reasoning as every other ownership
// check in this codebase.
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
  params: Promise<{ id: string; variantId: string }>;
}

const PatchBody = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  value: z.string().trim().min(1).max(60).optional(),
  priceDeltaCents: z.number().int().optional(),
  // Whole-number-for-UNIT is checked below against the parent product's unit.
  quantity: z.number().min(0).optional(),
});

async function findOwnedVariant(userId: string, productId: string, variantId: string) {
  const { product } = await findOwnedProduct(userId, productId);
  if (!product) return null;
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId: product.id },
  });
  if (!variant) return null;
  return { product, variant };
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id, variantId } = await ctx.params;
    const owned = await findOwnedVariant(auth.user.sub, id, variantId);
    if (!owned) {
      return NextResponse.json(
        { error: 'VARIANT_NOT_FOUND', message: 'No such variant.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    const { product, variant } = owned;

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (
      parsed.data.quantity !== undefined &&
      !isValidQuantityForUnit(parsed.data.quantity, product.unit)
    ) {
      return NextResponse.json(
        {
          error: 'VALIDATION_FAILED',
          message: 'Quantity must be a whole number for a per-item product.',
        },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const data = Object.fromEntries(
      Object.entries({
        ...parsed.data,
        ...(parsed.data.quantity !== undefined
          ? { quantity: roundQuantity(parsed.data.quantity) }
          : {}),
      }).filter(([, v]) => v !== undefined),
    );

    const updated = await prisma.productVariant.update({
      where: { id: variant.id },
      data,
    });

    return NextResponse.json(
      { variant: updated },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id, variantId } = await ctx.params;
    const owned = await findOwnedVariant(auth.user.sub, id, variantId);
    if (!owned) {
      return NextResponse.json(
        { error: 'VARIANT_NOT_FOUND', message: 'No such variant.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await prisma.productVariant.delete({ where: { id: owned.variant.id } });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
