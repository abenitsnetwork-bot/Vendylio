// Builds the frozen breakdown for a completed withdrawal. Pure reads +
// arithmetic — the caller (generate.ts) persists the WithdrawalStatement row.
//
// The statement has two parts:
//   1. Activity over the period — every order paid between the previous
//      statement's periodTo (or the store's createdAt) and this payout's
//      completion, grouped by payment method. Stripe Connect and Cash App /
//      Zelle money never passed through Vendylio, so those rows are marked
//      "info only".
//   2. This payout — the hard numbers: gross debit, the commission line-items
//      withheld (CommissionCharge rows settled by this withdrawal), net paid.
// The two don't chain arithmetically (a seller withdraws a partial amount
// whenever they like); the PDF says so.
import 'server-only';
import type { PrismaClient } from '@prisma/client';

import { resolveOwnStore } from '@/lib/server/org';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import { formatOrderNumber } from '@/lib/orderNumber';
import type {
  BuiltStatement,
  StatementCommissionLine,
  StatementData,
  StatementSalesGroup,
} from './types';

const SALES_STATUSES = [...PAID_ORDER_STATUSES, 'REFUNDED'];

const PROVIDER_META: Record<
  string,
  { label: string; settlement: StatementSalesGroup['settlement'] }
> = {
  stripe_platform: { label: 'Card — held & paid out by Vendylio', settlement: 'vendylio' },
  stripe_connect: { label: 'Card — direct to your Stripe account', settlement: 'seller_stripe' },
  cashapp_manual: { label: 'Cash App — received directly', settlement: 'seller_direct' },
  zelle_manual: { label: 'Zelle — received directly', settlement: 'seller_direct' },
};

function destinationLabel(d: unknown): string {
  const dest = (d ?? {}) as { method?: string; cashtag?: string; contact?: string };
  if (dest.method === 'CASH_APP') return `Cash App ${dest.cashtag ?? ''}`.trim();
  if (dest.method === 'ZELLE') return `Zelle ${dest.contact ?? ''}`.trim();
  if (dest.method === 'BANK') return 'Bank (ACH via Stripe)';
  return dest.method ?? 'Unknown method';
}

/**
 * @returns the built statement, or `null` when there is nothing to generate
 *   (withdrawal missing / not COMPLETED / no resolvable store).
 */
export async function buildStatementForWithdrawal(
  prisma: PrismaClient,
  withdrawalId: string,
): Promise<BuiltStatement | null> {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal || withdrawal.status !== 'COMPLETED') return null;

  const store = await resolveOwnStore(withdrawal.userId);
  if (!store) return null;

  const periodTo = withdrawal.completedAt ?? new Date();
  const prev = await prisma.withdrawalStatement.findFirst({
    where: { storeId: store.id },
    orderBy: { periodTo: 'desc' },
    select: { periodTo: true },
  });
  let periodFrom = prev?.periodTo ?? store.createdAt;
  if (periodFrom > periodTo) periodFrom = periodTo; // defensive — never invert

  const currency = withdrawal.currency;

  const [orders, refundEvents, settledCharges] = await Promise.all([
    prisma.order.findMany({
      where: {
        storeId: store.id,
        paidAt: { gte: periodFrom, lt: periodTo },
        status: { in: SALES_STATUSES },
      },
      select: { provider: true, amount: true, commissionAmount: true, netAmount: true },
    }),
    prisma.orderStatusEvent.findMany({
      where: {
        status: 'REFUNDED',
        createdAt: { gte: periodFrom, lt: periodTo },
        order: { storeId: store.id },
      },
      select: { order: { select: { amount: true } } },
    }),
    prisma.commissionCharge.findMany({
      where: { settledByWithdrawalId: withdrawal.id },
      orderBy: { createdAt: 'asc' },
      select: {
        amountCents: true,
        kind: true,
        createdAt: true,
        order: { select: { orderNumber: true } },
      },
    }),
  ]);

  // ── Section 1: sales grouped by payment method ────────────────────────
  const byProvider = new Map<string, StatementSalesGroup>();
  for (const o of orders) {
    const meta = PROVIDER_META[o.provider] ?? {
      label: o.provider,
      settlement: 'seller_direct' as const,
    };
    const g =
      byProvider.get(o.provider) ??
      ({
        provider: o.provider,
        label: meta.label,
        settlement: meta.settlement,
        orderCount: 0,
        grossCents: 0,
        commissionCents: 0,
        netCents: 0,
      } satisfies StatementSalesGroup);
    const commission = o.commissionAmount ?? 0;
    g.orderCount += 1;
    g.grossCents += o.amount;
    g.commissionCents += commission;
    g.netCents += o.netAmount ?? o.amount - commission;
    byProvider.set(o.provider, g);
  }
  const sales = [...byProvider.values()].sort((a, b) => b.grossCents - a.grossCents);
  const salesTotals = sales.reduce(
    (t, g) => ({
      orderCount: t.orderCount + g.orderCount,
      grossCents: t.grossCents + g.grossCents,
      commissionCents: t.commissionCents + g.commissionCents,
      netCents: t.netCents + g.netCents,
    }),
    { orderCount: 0, grossCents: 0, commissionCents: 0, netCents: 0 },
  );

  const refunds = {
    orderCount: refundEvents.length,
    amountCents: refundEvents.reduce((s, e) => s + (e.order?.amount ?? 0), 0),
  };

  // ── Section 2: this payout ───────────────────────────────────────────
  const commissionLines: StatementCommissionLine[] = settledCharges.map((c) => ({
    orderNumber: c.order?.orderNumber != null ? formatOrderNumber(c.order.orderNumber) : '—',
    kind: c.kind,
    accruedAt: c.createdAt.toISOString(),
    amountCents: c.amountCents,
  }));
  const netPayableCents = withdrawal.amount - withdrawal.commissionSettledCents;

  const data: StatementData = {
    schemaVersion: 1,
    storeName: store.name,
    storeSlug: store.slug,
    currency,
    periodFrom: periodFrom.toISOString(),
    periodTo: periodTo.toISOString(),
    generatedAt: new Date().toISOString(),
    sales,
    salesTotals,
    refunds,
    taxCents: 0,
    payout: {
      withdrawalId: withdrawal.id,
      method: destinationLabel(withdrawal.destination),
      status: withdrawal.status,
      requestedAt: withdrawal.requestedAt.toISOString(),
      completedAt: withdrawal.completedAt ? withdrawal.completedAt.toISOString() : null,
      grossCents: withdrawal.amount,
      commissionWithheldCents: withdrawal.commissionSettledCents,
      commissionLines,
      netPayableCents,
    },
  };

  return {
    storeId: store.id,
    data,
    periodFrom,
    periodTo,
    currency,
    grossSalesCents: salesTotals.grossCents,
    totalDeductionsCents: salesTotals.commissionCents + refunds.amountCents + data.taxCents,
    netPayableCents,
  };
}
