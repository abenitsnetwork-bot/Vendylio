// GET /api/admin/analytics — Phase 10 (extended). Chart-ready aggregates for
// the admin dashboard: revenue trend, customer growth, sales by category,
// top products. Everything here is derived from existing tables (Order,
// Customer, Product) — no new schema, no fabricated numbers.
//
// Scope: trailing 6 UTC months (inclusive of the current month). Revenue-
// by-category and top-products are computed by parsing the PAID orders'
// `lineItems` JSON snapshot in application code rather than a SQL GROUP BY
// — there's no relational OrderLineItem table (lineItems is a point-in-time
// JSON snapshot, see Order.lineItems in schema.prisma), so this is a single
// bounded query (6 months of PAID orders) reduced in memory. Fine at MVP
// scale; a store with a very large monthly order volume would want a real
// line-items table and a DB-side aggregate instead.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';

const MONTHS_BACK = 6;

interface OrderLineItemSnapshot {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Builds the last MONTHS_BACK UTC month buckets, oldest first. */
function monthBuckets(now: Date): { key: string; label: string; start: Date }[] {
  const buckets: { key: string; label: string; start: Date }[] = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    buckets.push({ key: monthKey(d), label: MONTH_LABELS[d.getUTCMonth()]!, start: d });
  }
  return buckets;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const now = new Date();
    const buckets = monthBuckets(now);
    const windowStart = buckets[0]!.start;

    const [paidOrders, customers] = await Promise.all([
      prisma.order.findMany({
        // Any order that reached PAID — including ones since advanced to
        // PREPARING/READY/OUT_FOR_DELIVERY/DELIVERED — is a real sale.
        where: { status: { in: [...PAID_ORDER_STATUSES] }, paidAt: { gte: windowStart } },
        select: { amount: true, paidAt: true, lineItems: true },
      }),
      prisma.customer.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
    ]);

    // Revenue + order count per month.
    const revenueByBucket = new Map<string, { gmvCents: number; orderCount: number }>();
    for (const b of buckets) revenueByBucket.set(b.key, { gmvCents: 0, orderCount: 0 });
    for (const order of paidOrders) {
      if (!order.paidAt) continue;
      const key = monthKey(
        new Date(Date.UTC(order.paidAt.getUTCFullYear(), order.paidAt.getUTCMonth(), 1)),
      );
      const bucket = revenueByBucket.get(key);
      if (!bucket) continue; // outside the window edge case, ignore
      bucket.gmvCents += order.amount;
      bucket.orderCount += 1;
    }
    const revenueByMonth = buckets.map((b) => ({ month: b.label, ...revenueByBucket.get(b.key)! }));

    // New customers per month.
    const customersByBucket = new Map<string, number>();
    for (const b of buckets) customersByBucket.set(b.key, 0);
    for (const c of customers) {
      const key = monthKey(
        new Date(Date.UTC(c.createdAt.getUTCFullYear(), c.createdAt.getUTCMonth(), 1)),
      );
      customersByBucket.set(key, (customersByBucket.get(key) ?? 0) + 1);
    }
    const customerGrowthByMonth = buckets.map((b) => ({
      month: b.label,
      newCustomers: customersByBucket.get(b.key) ?? 0,
    }));

    // Per-product revenue/units (from the lineItems snapshot — uses the
    // name AS SOLD, so a since-renamed or deleted product still shows
    // correctly here) + collect productIds for the category lookup below.
    const productAgg = new Map<string, { name: string; revenueCents: number; unitsSold: number }>();
    for (const order of paidOrders) {
      const items = order.lineItems as unknown as OrderLineItemSnapshot[];
      for (const item of items) {
        const existing = productAgg.get(item.productId);
        const lineRevenue = Math.round(item.priceCents * item.quantity);
        if (existing) {
          existing.revenueCents += lineRevenue;
          existing.unitsSold += item.quantity;
        } else {
          productAgg.set(item.productId, {
            name: item.name,
            revenueCents: lineRevenue,
            unitsSold: item.quantity,
          });
        }
      }
    }

    const productIds = [...productAgg.keys()];
    const products = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, category: { select: { name: true } } },
        })
      : [];
    const categoryNameByProductId = new Map(
      products.map((p) => [p.id, p.category?.name ?? 'Uncategorized']),
    );

    const categoryAgg = new Map<string, number>();
    for (const [productId, agg] of productAgg) {
      const category = categoryNameByProductId.get(productId) ?? 'Uncategorized';
      categoryAgg.set(category, (categoryAgg.get(category) ?? 0) + agg.revenueCents);
    }
    const salesByCategory = [...categoryAgg.entries()]
      .map(([category, revenueCents]) => ({ category, revenueCents }))
      .sort((a, b) => b.revenueCents - a.revenueCents);

    const topProducts = [...productAgg.entries()]
      .map(([productId, agg]) => ({ productId, ...agg }))
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 5);

    return NextResponse.json(
      { revenueByMonth, customerGrowthByMonth, salesByCategory, topProducts },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
