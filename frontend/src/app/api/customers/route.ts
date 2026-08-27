// GET /api/customers — Phase 6 seller-facing customer directory. Cursor-
// paginated, scoped to the caller's own store, same shape as GET
// /api/orders (lib/server/pagination/paginate.ts). Rows are upserted by the
// Stripe webhook's onPaid handler — see api/webhooks/stripe/route.ts.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';

const CUSTOMER_SELECT = {
  id: true,
  email: true,
  phone: true,
  name: true,
  address: true,
  totalSpentCents: true,
  ordersCount: true,
  createdAt: true,
} as const satisfies Prisma.CustomerSelect;

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

    const where: Prisma.CustomerWhereInput = {
      storeId: store.id,
      ...cursorWhere(cursor),
    };

    const rows = await prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: CUSTOMER_SELECT,
    });

    const page = buildPage(rows, limit);
    return NextResponse.json(page, { headers: { 'x-request-id': ctx.requestId } });
  });
}
