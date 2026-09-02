import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportColumn, ReportData } from '../types';
import { periodLabel, usd } from '../format';

/**
 * Guest-customer directory. Platform-wide it rolls up per store (customers,
 * new in window, repeat rate, avg spend). With a single store selected it
 * drills into the top customers by lifetime spend.
 */
export async function buildCustomers({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const customers = await prisma.customer.findMany({
    where: storeId ? { storeId } : {},
    select: {
      storeId: true,
      name: true,
      email: true,
      phone: true,
      totalSpentCents: true,
      ordersCount: true,
      createdAt: true,
      store: { select: { name: true } },
    },
  });

  const inWindow = (d: Date) => d >= from && d < to;
  const newInWindow = customers.filter((c) => inWindow(c.createdAt)).length;
  const repeat = customers.filter((c) => c.ordersCount > 1).length;

  let columns: ReportColumn[];
  let rows: Array<Record<string, string | number | null>>;

  if (storeId) {
    columns = [
      { key: 'customer', label: 'Customer' },
      { key: 'contact', label: 'Contact' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'spend', label: 'Lifetime spend', format: 'usd' },
      { key: 'avgOrder', label: 'Avg order', format: 'usd' },
      { key: 'since', label: 'First seen', format: 'date' },
    ];
    rows = customers
      .slice()
      .sort((a, b) => b.totalSpentCents - a.totalSpentCents)
      .slice(0, 200)
      .map((c) => ({
        customer: c.name ?? '(guest)',
        contact: c.email ?? c.phone ?? '',
        orders: c.ordersCount,
        spend: c.totalSpentCents,
        avgOrder: c.ordersCount > 0 ? Math.round(c.totalSpentCents / c.ordersCount) : 0,
        since: c.createdAt.toISOString(),
      }));
  } else {
    interface Agg {
      store: string;
      count: number;
      newCount: number;
      repeatCount: number;
      spend: number;
    }
    const byStore = new Map<string, Agg>();
    for (const c of customers) {
      let a = byStore.get(c.storeId);
      if (!a) {
        a = { store: c.store.name, count: 0, newCount: 0, repeatCount: 0, spend: 0 };
        byStore.set(c.storeId, a);
      }
      a.count += 1;
      if (inWindow(c.createdAt)) a.newCount += 1;
      if (c.ordersCount > 1) a.repeatCount += 1;
      a.spend += c.totalSpentCents;
    }
    columns = [
      { key: 'store', label: 'Store' },
      { key: 'customers', label: 'Customers', format: 'number' },
      { key: 'newInWindow', label: 'New in window', format: 'number' },
      { key: 'repeat', label: 'Repeat buyers', format: 'number' },
      { key: 'repeatRate', label: 'Repeat rate', format: 'percent' },
      { key: 'avgSpend', label: 'Avg lifetime spend', format: 'usd' },
    ];
    rows = [...byStore.values()]
      .map((a) => ({
        store: a.store,
        customers: a.count,
        newInWindow: a.newCount,
        repeat: a.repeatCount,
        repeatRate: a.count > 0 ? Number(((a.repeatCount / a.count) * 100).toFixed(1)) : 0,
        avgSpend: a.count > 0 ? Math.round(a.spend / a.count) : 0,
      }))
      .sort((x, y) => y.customers - x.customers);
  }

  const totalSpend = customers.reduce((s, c) => s + c.totalSpentCents, 0);

  return {
    type: 'customers',
    title: 'Customer cohorts',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Customers', value: customers.length.toLocaleString('en-US') },
      { label: 'New in window', value: newInWindow.toLocaleString('en-US') },
      {
        label: 'Repeat rate',
        value: customers.length ? `${((repeat / customers.length) * 100).toFixed(1)}%` : '—',
      },
      {
        label: 'Avg lifetime spend',
        value: customers.length ? usd(Math.round(totalSpend / customers.length)) : '—',
      },
    ],
    columns,
    rows,
    notes: [
      'The customer directory is cumulative (upserted on every paid order); "New in window" filters by first-seen date, all other columns are lifetime.',
      storeId
        ? 'Showing the top 200 customers of this store by lifetime spend.'
        : 'Select a single store to drill into its individual customers.',
    ],
  };
}
