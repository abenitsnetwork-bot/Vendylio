// GET /api/reviews — Phase 8 seller-facing review moderation list.
// Cursor-paginated, scoped to the caller's own store, same shape as
// GET /api/orders / GET /api/customers. Includes hidden reviews too (the
// seller needs to see everything to moderate) — the public storefront read
// (lib/server/storefront.ts) is what filters to visible=true only.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';

const REVIEW_SELECT = {
  id: true,
  orderId: true,
  rating: true,
  text: true,
  visible: true,
  createdAt: true,
  order: { select: { customerName: true } },
} as const satisfies Prisma.ReviewSelect;

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

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.ReviewWhereInput = {
      storeId: store.id,
      ...cursorWhere(cursor),
    };

    const rows = await prisma.review.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: REVIEW_SELECT,
    });

    const page = buildPage(rows, limit);
    return NextResponse.json(page, { headers: { 'x-request-id': ctx.requestId } });
  });
}
