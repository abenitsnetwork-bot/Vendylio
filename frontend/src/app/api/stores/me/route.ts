// GET /api/stores/me — the seller dashboard's data source.
//
// Phase 4: sales/orders stats are now real aggregates over PAID Orders
// (today = since UTC midnight, month = since the 1st of the UTC month —
// stateless API, no per-seller timezone stored, so UTC boundaries are the
// simplest correct choice rather than guessing a timezone). `visits` stays
// at 0 — there's no analytics pipeline in this build, so we don't fake it.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { countLowStock } from '@/lib/server/inventory/low-stock';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Sales stats must count every order that was actually paid, not just ones
// currently sitting in the PAID status — an order that has since progressed
// to PREPARING/READY/OUT_FOR_DELIVERY/DELIVERED was still a real sale. An
// exact `status: 'PAID'` match made revenue drop to $0 the moment a seller
// advanced an order past that first post-payment status.
const PAID_ORDER_STATUSES: string[] = [
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const ownStore = await resolveOwnStore(auth.user.sub);
    if (!ownStore) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const store = await prisma.store.findUniqueOrThrow({
      where: { id: ownStore.id },
      include: { _count: { select: { products: true } } },
    });

    const now = new Date();
    const [todayAgg, monthAgg, lowStock] = await Promise.all([
      prisma.order.aggregate({
        where: {
          storeId: store.id,
          status: { in: PAID_ORDER_STATUSES },
          paidAt: { gte: startOfUtcDay(now) },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.order.aggregate({
        where: {
          storeId: store.id,
          status: { in: PAID_ORDER_STATUSES },
          paidAt: { gte: startOfUtcMonth(now) },
        },
        _sum: { amount: true },
        _count: true,
      }),
      countLowStock(prisma, store.id),
    ]);

    const { _count, ...storeFields } = store;
    return NextResponse.json(
      {
        store: storeFields,
        stats: {
          productCount: _count.products,
          todaySalesCents: todayAgg._sum.amount ?? 0,
          todayOrdersCount: todayAgg._count,
          monthSalesCents: monthAgg._sum.amount ?? 0,
          monthOrdersCount: monthAgg._count,
          visits: 0,
          lowStockCount: lowStock.lowStockCount,
          outOfStockCount: lowStock.outOfStockCount,
        },
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
