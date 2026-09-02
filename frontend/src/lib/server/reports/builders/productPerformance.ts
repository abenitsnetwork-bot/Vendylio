import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

const TAKE = 20000;

interface LineItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

/**
 * Units sold + revenue per product in the window, from the paid orders'
 * `lineItems` snapshot (there is no relational line-item table). Current
 * product name / status / category are joined on top; a sold-then-deleted
 * product still appears under its name-as-sold.
 */
export async function buildProductPerformance({
  from,
  to,
  storeId,
}: ReportArgs): Promise<ReportData> {
  const where: Prisma.OrderWhereInput = {
    paidAt: { gte: from, lt: to },
    status: { in: [...PAID_ORDER_STATUSES] },
    ...(storeId ? { storeId } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    take: TAKE,
    select: { paidAt: true, lineItems: true },
  });

  interface Agg {
    name: string;
    units: number;
    revenue: number;
    orders: number;
    lastSold: Date | null;
  }
  const byProduct = new Map<string, Agg>();
  for (const o of orders) {
    const items = (o.lineItems as unknown as LineItem[] | null) ?? [];
    for (const it of items) {
      if (!it || typeof it.productId !== 'string') continue;
      let a = byProduct.get(it.productId);
      if (!a) {
        a = { name: it.name, units: 0, revenue: 0, orders: 0, lastSold: null };
        byProduct.set(it.productId, a);
      }
      a.units += it.quantity;
      a.revenue += Math.round(it.priceCents * it.quantity);
      a.orders += 1;
      if (o.paidAt && (!a.lastSold || o.paidAt > a.lastSold)) a.lastSold = o.paidAt;
    }
  }

  const ids = [...byProduct.keys()];
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          status: true,
          category: { select: { name: true } },
        },
      })
    : [];
  const meta = new Map(products.map((p) => [p.id, p]));

  const rows = [...byProduct.entries()]
    .map(([id, a]) => ({
      product: meta.get(id)?.name ?? a.name,
      category: meta.get(id)?.category?.name ?? 'Uncategorized',
      status: meta.get(id)?.status ?? 'deleted',
      units: Math.round(a.units * 100) / 100,
      revenue: a.revenue,
      orders: a.orders,
      avgPrice: a.units > 0 ? Math.round(a.revenue / a.units) : 0,
      lastSold: a.lastSold ? a.lastSold.toISOString() : null,
    }))
    .sort((x, y) => y.revenue - x.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);

  return {
    type: 'product-performance',
    title: 'Product performance',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Products sold', value: rows.length.toLocaleString('en-US') },
      { label: 'Units sold', value: totalUnits.toLocaleString('en-US') },
      { label: 'Revenue', value: usd(totalRevenue) },
      { label: 'Top product', value: rows[0]?.product ?? '—' },
      {
        label: 'Avg revenue / product',
        value: rows.length ? usd(Math.round(totalRevenue / rows.length)) : '—',
      },
    ],
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status' },
      { key: 'units', label: 'Units', format: 'number' },
      { key: 'revenue', label: 'Revenue', format: 'usd' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'avgPrice', label: 'Avg price', format: 'usd' },
      { key: 'lastSold', label: 'Last sold', format: 'date' },
    ],
    rows,
    notes: [
      'Revenue is the line price × quantity at the time of sale (delivery, tax and order-level discounts are not attributed to a product).',
      orders.length >= TAKE
        ? `Based on the ${TAKE.toLocaleString('en-US')} most recent paid orders in the window.`
        : '',
    ].filter(Boolean),
  };
}
