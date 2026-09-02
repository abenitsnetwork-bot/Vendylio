import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

/**
 * One row per store: activity in the window (orders, GMV, visits, conversion,
 * commission generated) plus lifecycle context (plan, created, last order)
 * and a health flag.
 */
export async function buildStorePerformance({
  from,
  to,
  storeId,
}: ReportArgs): Promise<ReportData> {
  const [stores, windowOrders, lastOrderByStore, visitGroups] = await Promise.all([
    prisma.store.findMany({
      where: storeId ? { id: storeId } : {},
      select: { id: true, name: true, plan: true, createdAt: true },
    }),
    prisma.order.findMany({
      where: {
        paidAt: { gte: from, lt: to },
        status: { in: [...PAID_ORDER_STATUSES] },
        ...(storeId ? { storeId } : {}),
      },
      select: { storeId: true, amount: true, commissionAmount: true },
    }),
    prisma.order.groupBy({
      by: ['storeId'],
      where: { status: { in: [...PAID_ORDER_STATUSES] }, ...(storeId ? { storeId } : {}) },
      _max: { paidAt: true },
    }),
    prisma.storefrontDayStat.groupBy({
      by: ['storeId'],
      where: { day: { gte: from, lt: to }, ...(storeId ? { storeId } : {}) },
      _sum: { storeViews: true, visitors: true },
    }),
  ]);

  const orderAgg = new Map<string, { orders: number; gmv: number; commission: number }>();
  for (const o of windowOrders) {
    let a = orderAgg.get(o.storeId);
    if (!a) {
      a = { orders: 0, gmv: 0, commission: 0 };
      orderAgg.set(o.storeId, a);
    }
    a.orders += 1;
    a.gmv += o.amount;
    a.commission += o.commissionAmount ?? 0;
  }
  const lastOrder = new Map(lastOrderByStore.map((g) => [g.storeId, g._max.paidAt ?? null]));
  const visits = new Map(
    visitGroups.map((g) => [
      g.storeId,
      { views: g._sum.storeViews ?? 0, visitors: g._sum.visitors ?? 0 },
    ]),
  );

  let active = 0;
  let dormant = 0;
  let created = 0;
  let onPro = 0;

  const rows = stores
    .map((s) => {
      const a = orderAgg.get(s.id) ?? { orders: 0, gmv: 0, commission: 0 };
      const v = visits.get(s.id) ?? { views: 0, visitors: 0 };
      const last = lastOrder.get(s.id) ?? null;
      const isNew = s.createdAt >= from;
      const hasRecentOrder = last !== null && last >= from;
      const flag = isNew ? 'New' : hasRecentOrder ? 'Active' : 'Dormant';
      if (flag === 'New') created += 1;
      else if (flag === 'Active') active += 1;
      else dormant += 1;
      if (s.plan === 'PRO') onPro += 1;
      return {
        store: s.name,
        plan: s.plan,
        created: s.createdAt.toISOString(),
        lastOrder: last ? last.toISOString() : null,
        orders: a.orders,
        gmv: a.gmv,
        aov: a.orders > 0 ? Math.round(a.gmv / a.orders) : 0,
        visitors: v.visitors,
        conversion: v.visitors > 0 ? Number(((a.orders / v.visitors) * 100).toFixed(1)) : 0,
        commission: a.commission,
        flag,
      };
    })
    .sort((x, y) => y.gmv - x.gmv);

  return {
    type: 'store-performance',
    title: 'Store performance',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Stores', value: String(stores.length) },
      { label: 'Active in window', value: String(active) },
      { label: 'Dormant', value: String(dormant) },
      { label: 'New in window', value: String(created) },
      { label: 'On Pro', value: String(onPro) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'plan', label: 'Plan' },
      { key: 'flag', label: 'Status' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'gmv', label: 'GMV', format: 'usd' },
      { key: 'aov', label: 'AOV', format: 'usd' },
      { key: 'visitors', label: 'Visitors', format: 'number' },
      { key: 'conversion', label: 'Conversion', format: 'percent' },
      { key: 'commission', label: 'Commission', format: 'usd' },
      { key: 'lastOrder', label: 'Last order', format: 'date' },
      { key: 'created', label: 'Created', format: 'date' },
    ],
    rows,
    notes: [
      '“Dormant” = created before the window with no paid order inside it. “New” = created during the window.',
      'Conversion = paid orders ÷ unique storefront visitors in the window.',
    ],
  };
}
