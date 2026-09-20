// Shared data source for the seller dashboard home page. Extracted out of
// `GET /api/stores/me` (which still calls this and returns the same JSON
// shape it always has, for client consumers like SellerSidebar) so the
// dashboard home page can call it directly, server-side, with zero HTTP
// round-trip and zero client-fetch flash — see dashboard/(shell)/page.tsx.
import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { countLowStock } from '@/lib/server/inventory/low-stock';
import { getStoreOpenState } from '@/lib/server/store/availability';
import { startOfStoreDay, startOfStoreMonth } from '@/lib/server/store/timezoneWindow';
import { recentVisitCount } from '@/lib/server/analytics/aggregate';
import type { Store } from '@prisma/client';

// See GET /api/stores/me for why this counts every order that was ever
// paid, not just ones currently sitting in PAID.
const PAID_ORDER_STATUSES: string[] = [
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];
const PENDING_ACTION_STATUSES: string[] = ['PAID', 'PREPARING', 'READY'];

export interface DashboardStore {
  id: string;
  slug: string;
  name: string;
}

export interface DashboardStats {
  productCount: number;
  todaySalesCents: number;
  todayOrdersCount: number;
  monthSalesCents: number;
  monthOrdersCount: number;
  allTimeSalesCents: number;
  allTimeOrdersCount: number;
  visits: number;
  pendingOrdersCount: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface DashboardOpenState {
  acceptingOrders: boolean;
  ordersPaused: boolean;
  pauseMessage: string | null;
  hoursConfigured: boolean;
  openNow: boolean;
  nextOpenLabel: string | null;
}

export interface RecentOrder {
  id: string;
  orderNumber: number;
  status: string;
  amount: number;
  currency: string;
  customerName: string | null;
  createdAt: string;
}

export interface DailySales {
  label: string;
  salesCents: number;
}

export interface DashboardOverview {
  userName: string | null;
  store: Omit<Store, never>;
  openState: DashboardOpenState;
  stats: DashboardStats;
  recentOrders: RecentOrder[];
  /** Last 7 calendar days (store timezone), oldest first, today last. */
  weeklySales: DailySales[];
  /** % of this month's paid orders that reached DELIVERED — 0 when there
   * were no paid orders this month (never NaN). */
  fulfillmentRatePct: number;
}

/** Resolves the caller's store + every metric the dashboard home needs, in
 * one batch of parallel queries. Returns `null` when the user has no store
 * yet (caller redirects to /onboarding). */
export async function getDashboardOverview(userId: string): Promise<DashboardOverview | null> {
  const ownStore = await resolveOwnStore(userId);
  if (!ownStore) return null;

  const [user, store] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.store.findUniqueOrThrow({
      where: { id: ownStore.id },
      include: { _count: { select: { products: true } } },
    }),
  ]);

  const now = new Date();
  const tz = store.timezone || 'UTC';

  // 7-day window (store timezone) for the "this week" trend chart — computed
  // as day-boundary instants so orders can be bucketed in one pass below
  // instead of running 7 separate date-ranged queries.
  const dayStarts: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    dayStarts.push(startOfStoreDay(tz, new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }

  const [
    todayAgg,
    monthAgg,
    allTimeAgg,
    lowStock,
    pendingCount,
    visits,
    deliveredThisMonthCount,
    weekOrders,
    recentOrderRows,
  ] = await Promise.all([
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
    prisma.order.aggregate({
      where: { storeId: store.id, status: { in: PAID_ORDER_STATUSES } },
      _sum: { amount: true },
      _count: true,
    }),
    countLowStock(prisma, store.id),
    prisma.order.count({
      where: { storeId: store.id, status: { in: PENDING_ACTION_STATUSES } },
    }),
    recentVisitCount(prisma, { storeId: store.id, tz }),
    prisma.order.count({
      where: {
        storeId: store.id,
        status: 'DELIVERED',
        paidAt: { gte: startOfStoreMonth(tz, now) },
      },
    }),
    prisma.order.findMany({
      where: {
        storeId: store.id,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: dayStarts[0]! },
      },
      select: { paidAt: true, amount: true },
    }),
    prisma.order.findMany({
      where: { storeId: store.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        amount: true,
        currency: true,
        customerName: true,
        createdAt: true,
      },
    }),
  ]);

  const weeklySales: DailySales[] = dayStarts.map((start, i) => {
    const end = i < dayStarts.length - 1 ? dayStarts[i + 1]! : null;
    const salesCents = weekOrders.reduce((sum, o) => {
      const t = o.paidAt?.getTime();
      if (t == null || t < start.getTime()) return sum;
      if (end && t >= end.getTime()) return sum;
      return sum + o.amount;
    }, 0);
    return {
      label: start.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz }),
      salesCents,
    };
  });

  const fulfillmentRatePct =
    monthAgg._count > 0 ? Math.round((deliveredThisMonthCount / monthAgg._count) * 100) : 0;

  const openState = getStoreOpenState({ timezone: tz, hours: store.hours }, now);
  const { _count, ...storeFields } = store;

  return {
    userName: user?.name ?? null,
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
      allTimeSalesCents: allTimeAgg._sum.amount ?? 0,
      allTimeOrdersCount: allTimeAgg._count,
      pendingOrdersCount: pendingCount,
      visits,
      lowStockCount: lowStock.lowStockCount,
      outOfStockCount: lowStock.outOfStockCount,
    },
    recentOrders: recentOrderRows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      amount: o.amount,
      currency: o.currency,
      customerName: o.customerName,
      createdAt: o.createdAt.toISOString(),
    })),
    weeklySales,
    fulfillmentRatePct,
  };
}
