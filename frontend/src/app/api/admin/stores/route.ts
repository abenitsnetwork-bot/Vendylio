// GET /api/admin/stores — platform-wide store list for the back-office.
// Mirrors the users-list pattern (cursor pagination, optional q/published
// filters). ADMIN can read (same level as /api/admin/users) — publishing
// state and owner identity aren't more sensitive than user PII, which
// ADMIN already sees.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const STORE_SELECT = {
  id: true,
  slug: true,
  name: true,
  published: true,
  plan: true,
  createdAt: true,
  organization: { select: { owner: { select: { id: true, email: true } } } },
  _count: { select: { products: true, orders: true } },
} as const satisfies Prisma.StoreSelect;

type StoreRow = Prisma.StoreGetPayload<{ select: typeof STORE_SELECT }>;

function flattenStore(store: StoreRow) {
  const { organization, _count, ...rest } = store;
  return {
    ...rest,
    ownerId: organization.owner.id,
    ownerEmail: organization.owner.email,
    productCount: _count.products,
    orderCount: _count.orders,
  };
}

const Q_MAX = 200;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const q = (url.searchParams.get('q') ?? '').slice(0, Q_MAX).trim();
    const publishedParam = url.searchParams.get('published');
    const planParam = url.searchParams.get('plan');
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.StoreWhereInput = {
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(publishedParam === 'true' ? { published: true } : {}),
      ...(publishedParam === 'false' ? { published: false } : {}),
      ...(planParam === 'FREE' || planParam === 'PRO' ? { plan: planParam } : {}),
      ...cursorWhere(cursor),
    };

    const rows = await prisma.store.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: STORE_SELECT,
    });

    const page = buildPage(rows, limit);
    return NextResponse.json(
      { ...page, items: page.items.map(flattenStore) },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
