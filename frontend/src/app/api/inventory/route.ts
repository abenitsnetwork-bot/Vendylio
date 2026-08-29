// GET /api/inventory — the seller's stock overview: one row per product
// without variants, one row per variant otherwise (variant stock is
// authoritative once a product has any). Each row carries its effective
// low-stock threshold and OK/LOW/OUT status.
//
// Filters: ?q= (product name), ?categoryId= (__none__ = uncategorized),
// ?filter= low | out | all (default all). Cursor pagination is product-level
// (a product's variant rows always travel together on one page).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { stockStatus } from '@/lib/server/inventory/adjust';

const UNCATEGORIZED_FILTER = '__none__';

export interface InventoryRow {
  productId: string;
  productName: string;
  imageUrl: string | null;
  unit: string;
  categoryName: string | null;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  lowStockThreshold: number | null; // the product's own override, if any
  effectiveThreshold: number;
  status: 'OK' | 'LOW' | 'OUT';
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
    const filter = url.searchParams.get('filter'); // low | out | all

    const where = {
      storeId: store.id,
      ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(categoryId === UNCATEGORIZED_FILTER
        ? { categoryId: null }
        : categoryId
          ? { categoryId }
          : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.product.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        category: { select: { name: true } },
        variants: { orderBy: { createdAt: 'asc' } },
      },
    });

    const { items, nextCursor } = buildPage(rows, limit);
    const storeDefault = store.defaultLowStockThreshold;

    const inventory: InventoryRow[] = [];
    for (const p of items) {
      const effectiveThreshold = p.lowStockThreshold ?? storeDefault;
      if (p.variants.length > 0) {
        for (const v of p.variants) {
          inventory.push({
            productId: p.id,
            productName: p.name,
            imageUrl: p.imageUrl,
            unit: p.unit,
            categoryName: p.category?.name ?? null,
            variantId: v.id,
            variantLabel: `${v.name}: ${v.value}`,
            quantity: v.quantity,
            lowStockThreshold: p.lowStockThreshold,
            effectiveThreshold,
            status: stockStatus(v.quantity, effectiveThreshold),
          });
        }
      } else {
        inventory.push({
          productId: p.id,
          productName: p.name,
          imageUrl: p.imageUrl,
          unit: p.unit,
          categoryName: p.category?.name ?? null,
          variantId: null,
          variantLabel: null,
          quantity: p.quantity,
          lowStockThreshold: p.lowStockThreshold,
          effectiveThreshold,
          status: stockStatus(p.quantity, effectiveThreshold),
        });
      }
    }

    const filtered =
      filter === 'low'
        ? inventory.filter((r) => r.status === 'LOW')
        : filter === 'out'
          ? inventory.filter((r) => r.status === 'OUT')
          : inventory;

    return NextResponse.json(
      { rows: filtered, nextCursor },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
