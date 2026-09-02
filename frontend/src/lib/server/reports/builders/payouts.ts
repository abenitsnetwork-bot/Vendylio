import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

function destinationLabel(d: unknown): string {
  const dest = (d ?? {}) as { method?: string; cashtag?: string; contact?: string };
  if (dest.method === 'CASH_APP') return `Cash App ${dest.cashtag ?? ''}`.trim();
  if (dest.method === 'ZELLE') return `Zelle ${dest.contact ?? ''}`.trim();
  if (dest.method === 'BANK') return 'Bank (ACH)';
  return dest.method ?? 'Unknown';
}

/** Every withdrawal requested in the window: who, which store, gross vs net. */
export async function buildPayouts({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.WithdrawalWhereInput = { requestedAt: { gte: from, lt: to } };

  if (storeId) {
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { organizationId: true },
    });
    const members = store
      ? await prisma.organizationMember.findMany({
          where: { organizationId: store.organizationId },
          select: { userId: true },
        })
      : [];
    where.userId = { in: members.map((m) => m.userId) };
  }

  const withdrawals = await prisma.withdrawal.findMany({
    where,
    orderBy: [{ requestedAt: 'desc' }],
    take: 5000,
    select: {
      userId: true,
      amount: true,
      commissionSettledCents: true,
      status: true,
      destination: true,
      requestedAt: true,
      completedAt: true,
      user: { select: { email: true } },
    },
  });

  const userIds = [...new Set(withdrawals.map((w) => w.userId))];
  const memberships = userIds.length
    ? await prisma.organizationMember.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, organization: { select: { store: { select: { name: true } } } } },
      })
    : [];
  const storeByUser = new Map(
    memberships.map((m) => [m.userId, m.organization.store?.name ?? null]),
  );

  const rows = withdrawals.map((w) => ({
    date: w.requestedAt.toISOString(),
    store: storeByUser.get(w.userId) ?? '(no store)',
    requester: w.user?.email ?? w.userId,
    method: destinationLabel(w.destination),
    status: w.status,
    gross: w.amount,
    withheld: w.commissionSettledCents,
    net: w.amount - w.commissionSettledCents,
  }));

  const sum = (pred: (s: string) => boolean, pick: (r: (typeof rows)[number]) => number) =>
    rows.filter((r) => pred(r.status)).reduce((s, r) => s + pick(r), 0);

  const netPaid = sum(
    (s) => s === 'COMPLETED',
    (r) => r.net,
  );
  const pendingLiability = sum(
    (s) => s === 'PENDING' || s === 'PROCESSING',
    (r) => r.gross,
  );
  const commissionRecovered = sum(
    (s) => s === 'COMPLETED',
    (r) => r.withheld,
  );

  return {
    type: 'payouts',
    title: 'Payouts',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Requests', value: String(rows.length) },
      { label: 'Net paid (completed)', value: usd(netPaid) },
      { label: 'Pending liability', value: usd(pendingLiability) },
      { label: 'Commission recovered', value: usd(commissionRecovered) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'requester', label: 'Requested by' },
      { key: 'date', label: 'Requested', format: 'date' },
      { key: 'method', label: 'Method' },
      { key: 'status', label: 'Status' },
      { key: 'gross', label: 'Gross', format: 'usd' },
      { key: 'withheld', label: 'Commission withheld', format: 'usd' },
      { key: 'net', label: 'Net paid', format: 'usd' },
    ],
    rows,
    notes: [
      'Gross is the amount debited from the merchant balance; net is what they receive after Cash App / Zelle commission is withheld.',
      rows.length >= 5000 ? 'Truncated to the 5,000 most recent requests.' : '',
    ].filter(Boolean),
  };
}
