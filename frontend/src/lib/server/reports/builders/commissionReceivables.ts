import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { usd } from '../format';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Snapshot (ignores the date range): the platform's outstanding Cash App /
 * Zelle commission receivable, per store, with OWED aged into buckets and
 * INVOICED (billed, awaiting payment) shown separately.
 */
export async function buildCommissionReceivables({ storeId }: ReportArgs): Promise<ReportData> {
  const charges = await prisma.commissionCharge.findMany({
    where: { status: { in: ['OWED', 'INVOICED'] }, ...(storeId ? { storeId } : {}) },
    select: { storeId: true, amountCents: true, status: true, createdAt: true },
  });

  const storeIds = [...new Set(charges.map((c) => c.storeId))];
  const stores = storeIds.length
    ? await prisma.store.findMany({
        where: { id: { in: storeIds } },
        select: { id: true, name: true, slug: true },
      })
    : [];
  const storeById = new Map(stores.map((s) => [s.id, s]));

  interface Agg {
    storeName: string;
    b0: number;
    b30: number;
    b60: number;
    b90: number;
    owed: number;
    invoiced: number;
    oldest: number | null;
  }
  const byStore = new Map<string, Agg>();
  const now = Date.now();
  for (const c of charges) {
    let a = byStore.get(c.storeId);
    if (!a) {
      a = {
        storeName: storeById.get(c.storeId)?.name ?? '(deleted store)',
        b0: 0,
        b30: 0,
        b60: 0,
        b90: 0,
        owed: 0,
        invoiced: 0,
        oldest: null,
      };
      byStore.set(c.storeId, a);
    }
    if (c.status === 'INVOICED') {
      a.invoiced += c.amountCents;
      continue;
    }
    a.owed += c.amountCents;
    const ageDays = (now - c.createdAt.getTime()) / DAY_MS;
    if (ageDays <= 30) a.b0 += c.amountCents;
    else if (ageDays <= 60) a.b30 += c.amountCents;
    else if (ageDays <= 90) a.b60 += c.amountCents;
    else a.b90 += c.amountCents;
    const t = c.createdAt.getTime();
    if (a.oldest === null || t < a.oldest) a.oldest = t;
  }

  const rows = [...byStore.values()]
    .sort((a, b) => b.owed - a.owed)
    .map((a) => ({
      store: a.storeName,
      owed: a.owed,
      b0: a.b0,
      b30: a.b30,
      b60: a.b60,
      b90: a.b90,
      invoiced: a.invoiced,
      oldest: a.oldest ? new Date(a.oldest).toISOString() : null,
    }));

  const totalOwed = rows.reduce((s, r) => s + r.owed, 0);
  const totalInvoiced = rows.reduce((s, r) => s + r.invoiced, 0);
  const over90 = rows.reduce((s, r) => s + r.b90, 0);

  return {
    type: 'commission-receivables',
    title: 'Commission receivables (aging)',
    period: null,
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Total owed', value: usd(totalOwed) },
      { label: 'Invoiced (awaiting)', value: usd(totalInvoiced) },
      { label: 'Stores with a balance', value: String(rows.length) },
      { label: 'Owed 90+ days', value: usd(over90) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'owed', label: 'Owed', format: 'usd' },
      { key: 'b0', label: '0–30d', format: 'usd' },
      { key: 'b30', label: '31–60d', format: 'usd' },
      { key: 'b60', label: '61–90d', format: 'usd' },
      { key: 'b90', label: '90d+', format: 'usd' },
      { key: 'invoiced', label: 'Invoiced', format: 'usd' },
      { key: 'oldest', label: 'Oldest charge', format: 'date' },
    ],
    rows,
    notes: [
      'OWED is collected by withholding it from the store’s next payout, or by a Stripe invoice once it clears the minimum. INVOICED is billed and awaiting invoice.paid.',
      'Aging is measured from each charge’s creation date.',
    ],
  };
}
