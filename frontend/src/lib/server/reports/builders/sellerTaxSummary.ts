import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

// Classic federal 1099-K reporting threshold (pre-2024). The de-minimis has
// been lowered and varies by tax year + state; the flag is a hint, not advice.
const GROSS_THRESHOLD_CENTS = 2_000_000; // $20,000
const TXN_THRESHOLD = 200;

/**
 * Per-store gross payment volume PROCESSED BY VENDYLIO (card only) in the
 * window — the basis for a 1099-K. Cash App / Zelle money is peer-to-peer,
 * never touches the platform, and is excluded.
 */
export async function buildSellerTaxSummary({
  from,
  to,
  storeId,
}: ReportArgs): Promise<ReportData> {
  const where: Prisma.OrderWhereInput = {
    paidAt: { gte: from, lt: to },
    status: { in: [...PAID_ORDER_STATUSES, 'REFUNDED'] },
    provider: { in: ['stripe_platform', 'stripe_connect'] },
    ...(storeId ? { storeId } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    select: { storeId: true, amount: true, status: true, commissionAmount: true },
  });

  interface Agg {
    gross: number;
    txns: number;
    refunds: number;
    commission: number;
  }
  const byStore = new Map<string, Agg>();
  for (const o of orders) {
    let a = byStore.get(o.storeId);
    if (!a) {
      a = { gross: 0, txns: 0, refunds: 0, commission: 0 };
      byStore.set(o.storeId, a);
    }
    if (o.status === 'REFUNDED') {
      a.refunds += o.amount;
    } else {
      a.gross += o.amount;
      a.txns += 1;
      a.commission += o.commissionAmount ?? 0;
    }
  }

  const ids = [...byStore.keys()];
  const stores = ids.length
    ? await prisma.store.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          organization: { select: { owner: { select: { email: true } } } },
        },
      })
    : [];
  const infoById = new Map(stores.map((s) => [s.id, s]));

  const rows = [...byStore.entries()]
    .map(([id, a]) => {
      const flagged = a.gross >= GROSS_THRESHOLD_CENTS && a.txns >= TXN_THRESHOLD;
      return {
        store: infoById.get(id)?.name ?? '(deleted store)',
        owner: infoById.get(id)?.organization?.owner?.email ?? '',
        grossVolume: a.gross,
        transactions: a.txns,
        refunds: a.refunds,
        netVolume: a.gross - a.refunds,
        commission: a.commission,
        flag: flagged ? '1099-K' : '',
      };
    })
    .sort((x, y) => y.grossVolume - x.grossVolume);

  const totalGross = rows.reduce((s, r) => s + r.grossVolume, 0);
  const totalTxns = rows.reduce((s, r) => s + r.transactions, 0);
  const totalRefunds = rows.reduce((s, r) => s + r.refunds, 0);
  const flaggedCount = rows.filter((r) => r.flag).length;

  return {
    type: 'seller-tax-summary',
    title: 'Seller tax summary (1099-K basis)',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Card volume processed', value: usd(totalGross) },
      { label: 'Card transactions', value: totalTxns.toLocaleString('en-US') },
      { label: 'Over $20k & 200 txns', value: String(flaggedCount) },
      { label: 'Refunds', value: usd(totalRefunds) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'owner', label: 'Owner' },
      { key: 'grossVolume', label: 'Gross volume', format: 'usd' },
      { key: 'transactions', label: 'Transactions', format: 'number' },
      { key: 'refunds', label: 'Refunds', format: 'usd' },
      { key: 'netVolume', label: 'Net volume', format: 'usd' },
      { key: 'commission', label: 'Platform commission', format: 'usd' },
      { key: 'flag', label: 'Threshold' },
    ],
    rows,
    notes: [
      'Gross volume is the sum of card payments processed through Vendylio (Stripe), before refunds — the 1099-K definition.',
      'Cash App / Zelle payments are peer-to-peer, never processed by Vendylio, and are the seller’s own reportable income — excluded here.',
      'The $20,000 / 200-transaction flag is the classic federal threshold. The current de-minimis is lower and varies by tax year and state; treat the flag as a hint, not tax advice.',
    ],
  };
}
