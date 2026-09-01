// Phase 4a — storefront analytics: write + read helpers over the daily
// aggregate tables (StorefrontDayStat / ProductViewDayStat).
//
// The day is bucketed in the STORE's own timezone (Store.timezone), stored
// in a `@db.Date` column as the UTC-midnight instant of that local date — so
// `new Date("2026-09-01T00:00:00.000Z")` round-trips to `2026-09-01`
// regardless of the store's offset (a plain `startOfStoreDay` instant would
// land on the wrong calendar date for positive-offset zones).
import 'server-only';
import type { PrismaClient } from '@prisma/client';

/** Orders that were really paid (mirrors GET /api/stores/me). */
const PAID_ORDER_STATUSES: string[] = [
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/** `YYYY-MM-DD` for `now` in `tz` (falls back to UTC on an unknown zone). */
export function storeDayKey(tz: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

/** The `@db.Date` value for a `YYYY-MM-DD` key. */
export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The store-local day bucket for `now`, as a Date for Prisma. */
export function storeDay(tz: string, now: Date = new Date()): Date {
  return dayKeyToDate(storeDayKey(tz, now));
}

export type ViewKind = 'STORE' | 'PRODUCT';

export interface RecordViewInput {
  storeId: string;
  tz: string;
  kind: ViewKind;
  /** Only honoured when kind === 'PRODUCT' and the product belongs to the store. */
  productId?: string | null;
  /** The request arrived without a `vnd_vid` cookie — count it as a new visitor. */
  newVisitor: boolean;
  now?: Date;
}

/**
 * Upsert the per-day counters for one storefront view. Never throws on a
 * bad productId — a PRODUCT hit with an id that isn't in the store just
 * records the store-level counters.
 */
export async function recordStorefrontView(
  prisma: PrismaClient,
  input: RecordViewInput,
): Promise<void> {
  const day = storeDay(input.tz, input.now);
  const isProduct = input.kind === 'PRODUCT';
  const visitorInc = input.newVisitor ? 1 : 0;

  await prisma.storefrontDayStat.upsert({
    where: { storeId_day: { storeId: input.storeId, day } },
    create: {
      storeId: input.storeId,
      day,
      storeViews: isProduct ? 0 : 1,
      productViews: isProduct ? 1 : 0,
      visitors: visitorInc,
    },
    update: {
      storeViews: { increment: isProduct ? 0 : 1 },
      productViews: { increment: isProduct ? 1 : 0 },
      visitors: { increment: visitorInc },
    },
  });

  if (isProduct && input.productId) {
    const owned = await prisma.product.findFirst({
      where: { id: input.productId, storeId: input.storeId },
      select: { id: true },
    });
    if (owned) {
      await prisma.productViewDayStat.upsert({
        where: { productId_day: { productId: input.productId, day } },
        create: { storeId: input.storeId, productId: input.productId, day, views: 1 },
        update: { views: { increment: 1 } },
      });
    }
  }
}

export interface AnalyticsSeriesPoint {
  day: string; // YYYY-MM-DD
  storeViews: number;
  productViews: number;
  visitors: number;
  orders: number;
  salesCents: number;
}

export interface AnalyticsSummary {
  range: number;
  series: AnalyticsSeriesPoint[];
  totals: {
    views: number;
    storeViews: number;
    productViews: number;
    visitors: number;
    orders: number;
    salesCents: number;
    /** orders / visitors, 0 when there are no visitors. */
    conversionRate: number;
  };
  topProducts: Array<{ productId: string; name: string; views: number }>;
}

/** Enumerate `YYYY-MM-DD` keys from `days`-ago through today (store tz). */
function dayKeyRange(tz: string, days: number, now: Date): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(storeDayKey(tz, new Date(now.getTime() - i * 24 * 60 * 60 * 1000)));
  }
  return keys;
}

export async function readAnalytics(
  prisma: PrismaClient,
  opts: { storeId: string; tz: string; range: number; now?: Date },
): Promise<AnalyticsSummary> {
  const now = opts.now ?? new Date();
  const range = opts.range;
  const keys = dayKeyRange(opts.tz, range, now);
  const startDay = dayKeyToDate(keys[0]!);

  const [dayStats, orders, topRaw] = await Promise.all([
    prisma.storefrontDayStat.findMany({
      where: { storeId: opts.storeId, day: { gte: startDay } },
      orderBy: { day: 'asc' },
    }),
    prisma.order.findMany({
      where: {
        storeId: opts.storeId,
        status: { in: PAID_ORDER_STATUSES },
        paidAt: { gte: startDay },
      },
      select: { paidAt: true, amount: true },
    }),
    prisma.productViewDayStat.groupBy({
      by: ['productId'],
      where: { storeId: opts.storeId, day: { gte: startDay } },
      _sum: { views: true },
      orderBy: { _sum: { views: 'desc' } },
      take: 10,
    }),
  ]);

  // Bucket views by their stored day key.
  const viewsByKey = new Map<
    string,
    { storeViews: number; productViews: number; visitors: number }
  >();
  for (const s of dayStats) {
    const key = s.day.toISOString().slice(0, 10);
    viewsByKey.set(key, {
      storeViews: s.storeViews,
      productViews: s.productViews,
      visitors: s.visitors,
    });
  }

  // Bucket orders by the store-local day of paidAt.
  const ordersByKey = new Map<string, { orders: number; salesCents: number }>();
  for (const o of orders) {
    if (!o.paidAt) continue;
    const key = storeDayKey(opts.tz, o.paidAt);
    const cur = ordersByKey.get(key) ?? { orders: 0, salesCents: 0 };
    cur.orders += 1;
    cur.salesCents += o.amount;
    ordersByKey.set(key, cur);
  }

  const series: AnalyticsSeriesPoint[] = keys.map((day) => {
    const v = viewsByKey.get(day) ?? { storeViews: 0, productViews: 0, visitors: 0 };
    const ord = ordersByKey.get(day) ?? { orders: 0, salesCents: 0 };
    return {
      day,
      storeViews: v.storeViews,
      productViews: v.productViews,
      visitors: v.visitors,
      orders: ord.orders,
      salesCents: ord.salesCents,
    };
  });

  const totals = series.reduce(
    (acc, p) => {
      acc.storeViews += p.storeViews;
      acc.productViews += p.productViews;
      acc.visitors += p.visitors;
      acc.orders += p.orders;
      acc.salesCents += p.salesCents;
      return acc;
    },
    { storeViews: 0, productViews: 0, visitors: 0, orders: 0, salesCents: 0 },
  );

  const topIds = topRaw.map((t) => t.productId);
  const names = topIds.length
    ? await prisma.product.findMany({
        where: { id: { in: topIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(names.map((n) => [n.id, n.name]));
  const topProducts = topRaw.map((t) => ({
    productId: t.productId,
    name: nameById.get(t.productId) ?? 'Deleted product',
    views: t._sum.views ?? 0,
  }));

  return {
    range,
    series,
    totals: {
      views: totals.storeViews + totals.productViews,
      storeViews: totals.storeViews,
      productViews: totals.productViews,
      visitors: totals.visitors,
      orders: totals.orders,
      salesCents: totals.salesCents,
      conversionRate: totals.visitors > 0 ? totals.orders / totals.visitors : 0,
    },
    topProducts,
  };
}

/** 30-day storefront-view sum for the dashboard headline number (all plans). */
export async function recentVisitCount(
  prisma: PrismaClient,
  opts: { storeId: string; tz: string; now?: Date },
): Promise<number> {
  const now = opts.now ?? new Date();
  const startDay = storeDay(opts.tz, new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const agg = await prisma.storefrontDayStat.aggregate({
    where: { storeId: opts.storeId, day: { gte: startDay } },
    _sum: { storeViews: true },
  });
  return agg?._sum?.storeViews ?? 0;
}
