import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { monthKey, monthLabel, periodLabel, usd } from '../format';

const PRO_MONTHLY_CENTS = 2900;
const PRO_ANNUAL_CENTS = 29000;
const ACTIVE_SUB_STATUSES = ['ACTIVE', 'TRIALING'];

/**
 * Platform earnings by month:
 *  - card commission — realised at the sale (Order.commissionAmount on
 *    stripe_platform / stripe_connect orders, by paidAt)
 *  - Cash App / Zelle commission — realised when collected (CommissionCharge
 *    flipped to SETTLED, by settledAt; negative REFUND_CREDIT rows reduce it)
 * Subscription revenue is reported as current MRR (Stripe holds the billed
 * history — we don't fabricate a monthly series for it).
 *
 * Phase 2G additions (§5/§6/§7): Stripe's own processing fee
 * (Order.stripeFeeCents, captured by Phase 2D — never estimated; a null
 * value is counted as "pending", not zero) alongside commission, and a
 * "Platform Contribution Before Operating Costs" KPI = commission − Stripe
 * fees recorded. Deliberately not called profit — it excludes payroll,
 * infrastructure, taxes, chargeback losses, and every other operating cost.
 */
export async function buildPlatformRevenue({ from, to }: ReportArgs): Promise<ReportData> {
  const [cardOrders, settledCharges, proStores] = await Promise.all([
    prisma.order.findMany({
      where: {
        paidAt: { gte: from, lt: to },
        status: { in: [...PAID_ORDER_STATUSES] },
        provider: { in: ['stripe_platform', 'stripe_connect'] },
      },
      select: { paidAt: true, commissionAmount: true, stripeFeeCents: true },
    }),
    prisma.commissionCharge.findMany({
      where: { status: 'SETTLED', settledAt: { gte: from, lt: to } },
      select: { settledAt: true, amountCents: true },
    }),
    prisma.store.findMany({
      where: { plan: 'PRO' },
      select: { subscriptionStatus: true, subscriptionInterval: true, planSource: true },
    }),
  ]);

  const months = new Map<
    string,
    { cardCents: number; manualCents: number; stripeFeeCents: number }
  >();
  const bucket = (k: string) => {
    let b = months.get(k);
    if (!b) {
      b = { cardCents: 0, manualCents: 0, stripeFeeCents: 0 };
      months.set(k, b);
    }
    return b;
  };
  let pendingFeeOrders = 0;
  for (const o of cardOrders) {
    if (!o.paidAt) continue;
    const b = bucket(monthKey(o.paidAt));
    b.cardCents += o.commissionAmount ?? 0;
    // Never estimated — a null stripeFeeCents is "not captured yet", not $0.
    if (o.stripeFeeCents !== null) b.stripeFeeCents += o.stripeFeeCents;
    else pendingFeeOrders += 1;
  }
  for (const c of settledCharges) {
    if (c.settledAt) bucket(monthKey(c.settledAt)).manualCents += c.amountCents;
  }

  const rows = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, b]) => ({
      month: monthLabel(k),
      card: b.cardCents,
      manual: b.manualCents,
      total: b.cardCents + b.manualCents,
      stripeFees: b.stripeFeeCents,
      contribution: b.cardCents + b.manualCents - b.stripeFeeCents,
    }));

  const totalCommission = rows.reduce((s, r) => s + r.total, 0);
  const totalStripeFees = rows.reduce((s, r) => s + r.stripeFees, 0);

  let mrrCents = 0;
  let activePro = 0;
  let compedPro = 0;
  for (const s of proStores) {
    if (s.planSource === 'COMP') compedPro += 1;
    if (
      s.planSource === 'SUBSCRIPTION' &&
      ACTIVE_SUB_STATUSES.includes(s.subscriptionStatus ?? '')
    ) {
      activePro += 1;
      mrrCents +=
        s.subscriptionInterval === 'year' ? Math.round(PRO_ANNUAL_CENTS / 12) : PRO_MONTHLY_CENTS;
    }
  }

  return {
    type: 'platform-revenue',
    title: 'Platform revenue',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Commission (period)', value: usd(totalCommission) },
      { label: 'Stripe fees recorded', value: usd(totalStripeFees) },
      {
        label: 'Platform Contribution Before Operating Costs',
        value: usd(totalCommission - totalStripeFees),
      },
      { label: 'Stripe fees pending capture', value: String(pendingFeeOrders) },
      { label: 'Current MRR', value: usd(mrrCents) },
      { label: 'Paying Pro stores', value: String(activePro) },
      { label: 'Comped Pro', value: String(compedPro) },
    ],
    columns: [
      { key: 'month', label: 'Month' },
      { key: 'card', label: 'Card commission', format: 'usd' },
      { key: 'manual', label: 'Cash App / Zelle commission', format: 'usd' },
      { key: 'total', label: 'Total commission', format: 'usd' },
      { key: 'stripeFees', label: 'Stripe fees recorded', format: 'usd' },
      {
        key: 'contribution',
        label: 'Platform Contribution Before Operating Costs',
        format: 'usd',
      },
    ],
    rows,
    notes: [
      'Card commission is recognised at the time of sale; Cash App / Zelle commission when collected (withheld from a payout or a paid invoice).',
      'Subscription revenue is shown as current MRR — Stripe holds the billed history.',
      'Stripe fees are the authoritative amount Stripe itself charged (never estimated) — a paid order whose fee has not been captured yet is excluded from "Stripe fees recorded" and counted under "pending capture" instead, not treated as a $0 fee.',
      '"Platform Contribution Before Operating Costs" is commission minus Stripe processing fees only. It excludes payroll, infrastructure, taxes, chargeback losses, and every other operating cost — it is not a profit figure.',
    ],
  };
}
