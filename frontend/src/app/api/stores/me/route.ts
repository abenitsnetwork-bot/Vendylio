// GET /api/stores/me — the seller dashboard's data source.
//
// Phase 4: sales/orders stats are real aggregates over PAID Orders.
// Phase 8: the "today"/"this month" window is anchored to the store's own
// timezone (Store.timezone) instead of UTC — a US merchant's day shouldn't
// roll over at 7 PM. Also returns the store's live open/pause state and the
// pending-order count for the dashboard + nav badge. Phase 4a: `visits` is a
// real 30-day storefront-view sum (StorefrontDayStat) — the headline number
// for every plan; the detailed breakdown lives on the Pro-only
// /dashboard/analytics page (GET /api/analytics).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { countLowStock } from '@/lib/server/inventory/low-stock';
import { getStoreOpenState } from '@/lib/server/store/availability';
import { startOfStoreDay, startOfStoreMonth } from '@/lib/server/store/timezoneWindow';
import { recentVisitCount } from '@/lib/server/analytics/aggregate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

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

// Orders that still need the merchant to do something (surfaced as the nav
// badge + dashboard "needs attention" count).
const PENDING_ACTION_STATUSES: string[] = ['PAID', 'PREPARING', 'READY'];

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
    const tz = store.timezone || 'UTC';
    const [todayAgg, monthAgg, lowStock, pendingCount, visits] = await Promise.all([
      prisma.order.aggregate({
        where: {
          storeId: store.id,
          status: { in: PAID_ORDER_STATUSES },
          paidAt: { gte: startOfStoreDay(tz, now) },
        },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.order.aggregate({
        where: {
          storeId: store.id,
          status: { in: PAID_ORDER_STATUSES },
          paidAt: { gte: startOfStoreMonth(tz, now) },
        },
        _sum: { amount: true },
        _count: true,
      }),
      countLowStock(prisma, store.id),
      prisma.order.count({
        where: { storeId: store.id, status: { in: PENDING_ACTION_STATUSES } },
      }),
      recentVisitCount(prisma, { storeId: store.id, tz }),
    ]);

    const openState = getStoreOpenState({ timezone: tz, hours: store.hours }, now);

    const { _count, ...storeFields } = store;
    return NextResponse.json(
      {
        store: storeFields,
        openState: {
          acceptingOrders: !store.ordersPaused,
          ordersPaused: store.ordersPaused,
          pauseMessage: store.pauseMessage,
          hoursConfigured: openState.hoursConfigured,
          openNow: openState.openNow,
          nextOpenLabel: openState.nextOpenLabel,
        },
        stats: {
          productCount: _count.products,
          todaySalesCents: todayAgg._sum.amount ?? 0,
          todayOrdersCount: todayAgg._count,
          monthSalesCents: monthAgg._sum.amount ?? 0,
          monthOrdersCount: monthAgg._count,
          pendingOrdersCount: pendingCount,
          visits,
          lowStockCount: lowStock.lowStockCount,
          outOfStockCount: lowStock.outOfStockCount,
        },
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
