import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

/**
 * Gross merchandise value by store for the window (orders by paidAt).
 *
 * Phase 2G additions (§3/§4/§12): merchandise revenue uses the frozen
 * Order.taxableAmountCents when present (Phase 2B) — never recomputed from
 * current Discount config; an order that predates the freeze falls back to
 * its OWN persisted subtotalCents − discountCents (still the historical
 * order row, never today's PlatformSettings). Stripe fees, disputes-opened,
 * and outstanding commission are added per store — outstanding commission
 * is CommissionCharge's own OWED total (a live balance, not scoped to the
 * window — same definition the dedicated commission-receivables snapshot
 * report already uses; not recreated here, just re-read).
 */
export async function buildGmvSales({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.OrderWhereInput = {
    paidAt: { gte: from, lt: to },
    status: { in: [...PAID_ORDER_STATUSES, 'REFUNDED'] },
    ...(storeId ? { storeId } : {}),
  };

  const [orders, owedCharges, disputes] = await Promise.all([
    prisma.order.findMany({
      where,
      select: {
        storeId: true,
        amount: true,
        subtotalCents: true,
        discountCents: true,
        taxableAmountCents: true,
        commissionAmount: true,
        stripeFeeCents: true,
        status: true,
      },
    }),
    prisma.commissionCharge.findMany({
      where: { status: 'OWED', ...(storeId ? { storeId } : {}) },
      select: { storeId: true, amountCents: true },
    }),
    prisma.dispute.findMany({
      where: { createdAt: { gte: from, lt: to }, ...(storeId ? { storeId } : {}) },
      select: { storeId: true },
    }),
  ]);

  interface Agg {
    orders: number;
    gross: number;
    refunds: number;
    merchandiseRevenue: number;
    commission: number;
    stripeFees: number;
  }
  const byStore = new Map<string, Agg>();
  const getAgg = (storeIdKey: string) => {
    let a = byStore.get(storeIdKey);
    if (!a) {
      a = { orders: 0, gross: 0, refunds: 0, merchandiseRevenue: 0, commission: 0, stripeFees: 0 };
      byStore.set(storeIdKey, a);
    }
    return a;
  };
  for (const o of orders) {
    const a = getAgg(o.storeId);
    if (o.status === 'REFUNDED') {
      a.refunds += o.amount;
    } else {
      a.orders += 1;
      a.gross += o.amount;
      a.merchandiseRevenue += o.taxableAmountCents ?? o.subtotalCents - o.discountCents;
      a.commission += o.commissionAmount ?? 0;
      if (o.stripeFeeCents !== null) a.stripeFees += o.stripeFeeCents;
    }
  }
  const outstandingByStore = new Map<string, number>();
  for (const c of owedCharges) {
    outstandingByStore.set(c.storeId, (outstandingByStore.get(c.storeId) ?? 0) + c.amountCents);
  }
  const disputesByStore = new Map<string, number>();
  for (const d of disputes) {
    disputesByStore.set(d.storeId, (disputesByStore.get(d.storeId) ?? 0) + 1);
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
      merchandiseRevenue: a.merchandiseRevenue,
      commission: a.commission,
      stripeFees: a.stripeFees,
      disputes: disputesByStore.get(id) ?? 0,
      outstandingCommission: outstandingByStore.get(id) ?? 0,
    }))
    .sort((x, y) => y.netGmv - x.netGmv);

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalRefunds = rows.reduce((s, r) => s + r.refunds, 0);
  const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const totalMerchandiseRevenue = rows.reduce((s, r) => s + r.merchandiseRevenue, 0);
  const totalStripeFees = rows.reduce((s, r) => s + r.stripeFees, 0);
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
      { label: 'Merchandise revenue', value: usd(totalMerchandiseRevenue) },
      { label: 'Stripe fees recorded', value: usd(totalStripeFees) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'gross', label: 'GMV', format: 'usd' },
      { key: 'refunds', label: 'Refunds', format: 'usd' },
      { key: 'netGmv', label: 'Net GMV', format: 'usd' },
      { key: 'aov', label: 'AOV', format: 'usd' },
      { key: 'merchandiseRevenue', label: 'Merchandise revenue', format: 'usd' },
      { key: 'commission', label: 'Commission', format: 'usd' },
      { key: 'stripeFees', label: 'Stripe fees', format: 'usd' },
      { key: 'disputes', label: 'Disputes opened', format: 'number' },
      { key: 'outstandingCommission', label: 'Outstanding commission', format: 'usd' },
    ],
    rows,
    notes: [
      'Orders are counted by payment date. Refunds are orders paid in this window that were later refunded — a refund of an older order is not shown here.',
      'Merchandise revenue uses the taxable base frozen on each Order at checkout (subtotal minus merchandise-attributable discount) — it is not recomputed from current discount configuration.',
      'Stripe fees are the authoritative captured amount only — a paid order whose fee has not been captured yet contributes $0 here rather than an estimate (see the Platform revenue report for a pending-capture count).',
      'Outstanding commission is each store’s current Cash App / Zelle OWED balance (from CommissionCharge) — a live balance, not scoped to this date range. See the Commission receivables report for full aging.',
      'Disputes opened counts Stripe disputes opened during this window, regardless of when the underlying order was paid.',
    ],
  };
}
