import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

/** Gross merchandise value by store for the window (orders by paidAt). */
export async function buildGmvSales({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.OrderWhereInput = {
    paidAt: { gte: from, lt: to },
    status: { in: [...PAID_ORDER_STATUSES, 'REFUNDED'] },
    ...(storeId ? { storeId } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    select: { storeId: true, amount: true, commissionAmount: true, status: true },
  });

  interface Agg {
    orders: number;
    gross: number;
    refunds: number;
    commission: number;
  }
  const byStore = new Map<string, Agg>();
  for (const o of orders) {
    let a = byStore.get(o.storeId);
    if (!a) {
      a = { orders: 0, gross: 0, refunds: 0, commission: 0 };
      byStore.set(o.storeId, a);
    }
    if (o.status === 'REFUNDED') {
      a.refunds += o.amount;
    } else {
      a.orders += 1;
      a.gross += o.amount;
      a.commission += o.commissionAmount ?? 0;
    }
  }

  const storeIds = [...byStore.keys()];
  const stores = storeIds.length
    ? await prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(stores.map((s) => [s.id, s.name]));

  const rows = [...byStore.entries()]
    .map(([id, a]) => ({
      store: nameById.get(id) ?? '(deleted store)',
      orders: a.orders,
      gross: a.gross,
      refunds: a.refunds,
      netGmv: a.gross - a.refunds,
      aov: a.orders > 0 ? Math.round(a.gross / a.orders) : 0,
      commission: a.commission,
    }))
    .sort((x, y) => y.netGmv - x.netGmv);

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalRefunds = rows.reduce((s, r) => s + r.refunds, 0);
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const netGmv = totalGross - totalRefunds;

  return {
    type: 'gmv-sales',
    title: 'GMV & sales',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Net GMV', value: usd(netGmv) },
      { label: 'Orders', value: totalOrders.toLocaleString('en-US') },
      {
        label: 'Avg order value',
        value: usd(totalOrders > 0 ? Math.round(totalGross / totalOrders) : 0),
      },
      {
        label: 'Refund rate',
        value: totalGross > 0 ? `${((totalRefunds / totalGross) * 100).toFixed(1)}%` : '—',
      },
      {
        label: 'Blended take rate',
        value: netGmv > 0 ? `${((totalCommission / netGmv) * 100).toFixed(1)}%` : '—',
      },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'gross', label: 'GMV', format: 'usd' },
      { key: 'refunds', label: 'Refunds', format: 'usd' },
      { key: 'netGmv', label: 'Net GMV', format: 'usd' },
      { key: 'aov', label: 'AOV', format: 'usd' },
      { key: 'commission', label: 'Commission', format: 'usd' },
    ],
    rows,
    notes: [
      'Orders are counted by payment date. Refunds are orders paid in this window that were later refunded — a refund of an older order is not shown here.',
    ],
  };
}
