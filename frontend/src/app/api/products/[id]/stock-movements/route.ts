// GET /api/products/[id]/stock-movements — the inventory ledger for one of
// the caller's own products (all its variants included), newest first,
// cursor-paginated.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedProduct } from '@/lib/server/products/ownership';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';

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

    const url = new URL(req.url);
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const rows = await prisma.stockMovement.findMany({
      where: { productId: product.id, ...cursorWhere(cursor) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { variant: { select: { name: true, value: true } } },
    });

    const { items, nextCursor } = buildPage(rows, limit);

    return NextResponse.json(
      {
        movements: items.map((m) => ({
          id: m.id,
          delta: m.delta,
          resultingQuantity: m.resultingQuantity,
          reason: m.reason,
          note: m.note,
          orderId: m.orderId,
          actorType: m.actorType,
          createdAt: m.createdAt,
          variantLabel: m.variant ? `${m.variant.name}: ${m.variant.value}` : null,
        })),
        nextCursor,
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
