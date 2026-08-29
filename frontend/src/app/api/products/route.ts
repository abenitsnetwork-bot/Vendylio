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
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { PRODUCT_UNIT_VALUES } from '@/lib/productUnits';
import { isValidQuantityForUnit, roundQuantity } from '@/lib/quantity';

// `?categoryId=__none__` filters to products with no category.
const UNCATEGORIZED_FILTER = '__none__';

const Body = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(1000).optional(),
    priceCents: z.number().int().positive(),
    // Whole number for UNIT (checked below — a bare .int() here would also
    // block the fractional weight amounts a KG/LB/G/OZ product needs).
    quantity: z.number().min(0),
    // Per-store Category id, or null/omitted for "Uncategorized". Ownership
    // is verified against the caller's store below.
    categoryId: z.string().min(1).nullable().optional(),
    unit: z.enum(PRODUCT_UNIT_VALUES).optional().default('UNIT'),
    imageUrl: z.string().url().optional(),
    // Phase 3 — per-product low-stock threshold (null/omitted = store default).
    lowStockThreshold: z.number().int().min(0).optional(),
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

    const {
      name,
      description,
      priceCents,
      quantity,
      categoryId,
      unit,
      imageUrl,
      lowStockThreshold,
    } = parsed.data;

    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, storeId: store.id },
        select: { id: true },
      });
      if (!category) {
        return NextResponse.json(
          { error: 'VALIDATION_FAILED', message: 'Unknown category.' },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
    }

    const initialQuantity = roundQuantity(quantity);
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          storeId: store.id,
          name,
          priceCents,
          quantity: initialQuantity,
          unit,
          ...(categoryId ? { categoryId } : {}),
          ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}),
          ...(description ? { description } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        },
      });
      // Opening-balance row so the product's ledger isn't empty (matches
      // what migration 6_phase_inventory did for pre-existing products).
      await tx.stockMovement.create({
        data: {
          storeId: store.id,
          productId: created.id,
          delta: initialQuantity,
          resultingQuantity: initialQuantity,
          reason: 'CORRECTION',
          note: 'Opening balance',
          actorType: 'SELLER',
        },
      });
      return created;
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

    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const q = url.searchParams.get('q')?.trim() ?? '';
    const categoryId = url.searchParams.get('categoryId');
    const status = url.searchParams.get('status');

    const where = {
      storeId: store.id,
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(categoryId === UNCATEGORIZED_FILTER
        ? { categoryId: null }
        : categoryId
          ? { categoryId }
          : {}),
      ...(status === 'ACTIVE' || status === 'ARCHIVED' ? { status } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { category: { select: { id: true, name: true, slug: true, sortOrder: true } } },
    });

    const { items, nextCursor } = buildPage(rows, limit);
    return NextResponse.json(
      { products: items, nextCursor },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
