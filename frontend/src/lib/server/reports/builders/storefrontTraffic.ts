import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

/**
 * Storefront traffic by store for the window, from the daily aggregate
 * tables (StorefrontDayStat). Views, unique visitors, product views, plus
 * paid orders in the same window for a conversion rate.
 */
export async function buildStorefrontTraffic({
  from,
  to,
  storeId,
}: ReportArgs): Promise<ReportData> {
  const [groups, paidOrders] = await Promise.all([
    prisma.storefrontDayStat.groupBy({
      by: ['storeId'],
      where: { day: { gte: from, lt: to }, ...(storeId ? { storeId } : {}) },
      _sum: { storeViews: true, visitors: true, productViews: true },
    }),
    prisma.order.findMany({
      where: {
        paidAt: { gte: from, lt: to },
        status: { in: [...PAID_ORDER_STATUSES] },
        ...(storeId ? { storeId } : {}),
      },
      select: { storeId: true },
    }),
  ]);

  const ordersByStore = new Map<string, number>();
  for (const o of paidOrders) {
    ordersByStore.set(o.storeId, (ordersByStore.get(o.storeId) ?? 0) + 1);
  }

  const ids = groups.map((g) => g.storeId);
  const stores = ids.length
    ? await prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(stores.map((s) => [s.id, s.name]));

  const rows = groups
    .map((g) => {
      const views = g._sum.storeViews ?? 0;
      const visitors = g._sum.visitors ?? 0;
      const productViews = g._sum.productViews ?? 0;
      const orders = ordersByStore.get(g.storeId) ?? 0;
      return {
        store: nameById.get(g.storeId) ?? '(deleted store)',
        views,
        visitors,
        productViews,
        orders,
        conversion: visitors > 0 ? Number(((orders / visitors) * 100).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.views - a.views);

  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const totalVisitors = rows.reduce((s, r) => s + r.visitors, 0);
  const totalProductViews = rows.reduce((s, r) => s + r.productViews, 0);
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);

  return {
    type: 'storefront-traffic',
    title: 'Storefront traffic',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Storefront views', value: totalViews.toLocaleString('en-US') },
      { label: 'Unique visitors', value: totalVisitors.toLocaleString('en-US') },
      { label: 'Product views', value: totalProductViews.toLocaleString('en-US') },
      {
        label: 'Blended conversion',
        value: totalVisitors > 0 ? `${((totalOrders / totalVisitors) * 100).toFixed(1)}%` : '—',
      },
      { label: 'Stores with traffic', value: String(rows.length) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'views', label: 'Views', format: 'number' },
      { key: 'visitors', label: 'Visitors', format: 'number' },
      { key: 'productViews', label: 'Product views', format: 'number' },
      { key: 'orders', label: 'Paid orders', format: 'number' },
      { key: 'conversion', label: 'Conversion', format: 'percent' },
    ],
    rows,
    notes: [
      'Visitors are a first-party cookie approximation (no third-party tracking); the store owner previewing their own draft is not counted.',
      'Conversion = paid orders ÷ unique visitors in the same window.',
    ],
  };
}
