// POST /api/products — add a product to the caller's store.
// GET /api/products — list the caller's own products (all statuses — this is
// the seller's management view, not the public storefront, which reads via
// `getPublicStore` and only shows ACTIVE ones).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { PRODUCT_CATEGORY_VALUES } from '@/lib/productCategories';
import { PRODUCT_UNIT_VALUES } from '@/lib/productUnits';
import { isValidQuantityForUnit, roundQuantity } from '@/lib/quantity';

const Body = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    priceCents: z.number().int().positive(),
    // Whole number for UNIT (checked below — a bare .int() here would also
    // block the fractional weight amounts a KG/LB/G/OZ product needs).
    quantity: z.number().min(0),
    category: z.enum(PRODUCT_CATEGORY_VALUES),
    unit: z.enum(PRODUCT_UNIT_VALUES).optional().default('UNIT'),
    imageUrl: z.string().url().optional(),
  })
  .superRefine((data, ctx) => {
    if (!isValidQuantityForUnit(data.quantity, data.unit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quantity'],
        message: 'Quantity must be a whole number for a per-item product.',
      });
    }
  });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store before adding products.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const { name, description, priceCents, quantity, category, unit, imageUrl } = parsed.data;
    const product = await prisma.product.create({
      data: {
        storeId: store.id,
        name,
        priceCents,
        quantity: roundQuantity(quantity),
        category,
        unit,
        ...(description ? { description } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      },
    });

    return NextResponse.json(
      { product },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const products = await prisma.product.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ products }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
