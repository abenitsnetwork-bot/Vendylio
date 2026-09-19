import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

const TAKE = 5000;
// "At risk" — still open, still actionable, per Phase 2G §9. WON/LOST/
// WARNING_CLOSED are resolved; this is the operational worklist.
const AT_RISK_STATUSES = ['NEEDS_RESPONSE', 'UNDER_REVIEW'];

/**
 * Financial architecture (Phase 2G) — Stripe dispute summary from the
 * existing Dispute model (Phase 2A/2E). Reporting only: never mutates
 * Order.status, never subtracts from computeBalance(), never claws back a
 * LOST dispute — see the Dispute model's own schema comment for why that
 * stays an open business decision. Disputes are counted by createdAt (when
 * Stripe opened them), matching every other date-ranged report here.
 */
export async function buildDisputes({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.DisputeWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(storeId ? { storeId } : {}),
  };

  const disputes = await prisma.dispute.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: {
      amountCents: true,
      currency: true,
      reason: true,
      status: true,
      evidenceDueBy: true,
      createdAt: true,
      store: { select: { name: true } },
      order: { select: { orderNumber: true } },
    },
  });

  const rows = disputes.map((d) => ({
    openedOn: d.createdAt.toISOString(),
    order: formatOrderNumber(d.order.orderNumber),
    store: d.store.name,
    amount: d.amountCents,
    currency: d.currency,
    reason: d.reason ?? '—',
    status: d.status,
    evidenceDueBy: d.evidenceDueBy ? d.evidenceDueBy.toISOString() : null,
  }));

  const byStatus = new Map<string, { count: number; amount: number }>();
  for (const d of disputes) {
    let s = byStatus.get(d.status);
    if (!s) {
      s = { count: 0, amount: 0 };
      byStatus.set(d.status, s);
    }
    s.count += 1;
    s.amount += d.amountCents;
  }

  const totalAmount = disputes.reduce((s, d) => s + d.amountCents, 0);
  const atRisk = disputes.filter((d) => AT_RISK_STATUSES.includes(d.status));
  const atRiskAmount = atRisk.reduce((s, d) => s + d.amountCents, 0);

  const statusKpi = (status: string) => byStatus.get(status)?.count ?? 0;

  return {
    type: 'disputes',
    title: 'Disputes',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Total disputes', value: disputes.length.toLocaleString('en-US') },
      { label: 'Total disputed', value: usd(totalAmount) },
      { label: 'At risk (needs action)', value: atRisk.length.toLocaleString('en-US') },
      { label: 'At-risk amount', value: usd(atRiskAmount) },
      { label: 'Needs response', value: String(statusKpi('NEEDS_RESPONSE')) },
      { label: 'Under review', value: String(statusKpi('UNDER_REVIEW')) },
      { label: 'Won', value: String(statusKpi('WON')) },
      { label: 'Lost', value: String(statusKpi('LOST')) },
      { label: 'Warning closed', value: String(statusKpi('WARNING_CLOSED')) },
    ],
    columns: [
      { key: 'openedOn', label: 'Opened', format: 'date' },
      { key: 'order', label: 'Order' },
      { key: 'store', label: 'Store' },
      { key: 'amount', label: 'Amount', format: 'usd' },
      { key: 'currency', label: 'Currency' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Status' },
      { key: 'evidenceDueBy', label: 'Evidence due', format: 'date' },
    ],
    rows,
    notes: [
      'Disputes are counted by the date Stripe opened them, not the original order date.',
      'This report is informational only — it never changes Order status, the merchant balance, or pays out/claws back money. A LOST dispute’s business treatment is a separate, not-yet-implemented decision.',
      disputes.length >= TAKE
        ? `Truncated to the ${TAKE.toLocaleString('en-US')} most recent disputes.`
        : '',
    ].filter(Boolean),
  };
}
