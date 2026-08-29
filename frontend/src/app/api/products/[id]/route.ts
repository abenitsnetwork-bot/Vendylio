// PATCH + DELETE /api/products/[id] — edit or remove one of the caller's
// own products. Ownership is checked via `storeId` matching the caller's
// store, never by trusting the id alone — a 404 (not 403) on a mismatch so a
// seller can't probe another seller's product ids.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedProduct } from '@/lib/server/products/ownership';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { PRODUCT_UNIT_VALUES } from '@/lib/productUnits';
import { isValidQuantityForUnit, roundQuantity } from '@/lib/quantity';

const PatchBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceCents: z.number().int().positive().optional(),
  // Whole-number-for-UNIT is checked against the effective unit (this
  // request's `unit` if sent, else the product's existing one) once the
  // product row is in hand — not doable inside this schema alone.
  quantity: z.number().min(0).optional(),
  // Per-store Category id, or null to move the product to "Uncategorized".
  // Ownership of the id is verified against the caller's store below.
  categoryId: z.string().min(1).nullable().optional(),
  unit: z.enum(PRODUCT_UNIT_VALUES).optional(),
  imageUrl: z.string().url().nullable().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
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

    const variants = await prisma.productVariant.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json(
      { product, variants },
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
    const { store, product } = await findOwnedProduct(auth.user.sub, id);
    if (!store || !product) {
      return NextResponse.json(
        { error: 'PRODUCT_NOT_FOUND', message: 'No such product.' },
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

    if (parsed.data.categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: parsed.data.categoryId, storeId: store.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json(
          { error: 'VALIDATION_FAILED', message: 'Unknown category.' },
          { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
    }

    const effectiveUnit = parsed.data.unit ?? product.unit;
    if (
      parsed.data.quantity !== undefined &&
      !isValidQuantityForUnit(parsed.data.quantity, effectiveUnit)
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

    const updated = await prisma.product.update({
      where: { id: product.id },
      data,
    });

    return NextResponse.json(
      { product: updated },
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

    const { id } = await ctx.params;
    const { product } = await findOwnedProduct(auth.user.sub, id);
    if (!product) {
      return NextResponse.json(
        { error: 'PRODUCT_NOT_FOUND', message: 'No such product.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await prisma.product.delete({ where: { id: product.id } });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
