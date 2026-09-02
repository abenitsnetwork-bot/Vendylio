import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

const TAKE = 5000;

const PAYMENT_LABEL: Record<string, string> = {
  stripe_platform: 'Card',
  stripe_connect: 'Card (Connect)',
  cashapp_manual: 'Cash App',
  zelle_manual: 'Zelle',
};

/**
 * Orders refunded in the window — keyed on the REFUNDED status event, so a
 * refund of an order paid months earlier still shows up on the day it was
 * issued. One row per refunded order.
 */
export async function buildRefunds({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.OrderStatusEventWhereInput = {
    status: 'REFUNDED',
    createdAt: { gte: from, lt: to },
    ...(storeId ? { order: { storeId } } : {}),
  };

  const events = await prisma.orderStatusEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: {
      createdAt: true,
      order: {
        select: {
          orderNumber: true,
          amount: true,
          paidAt: true,
          provider: true,
          commissionAmount: true,
          store: { select: { name: true } },
        },
      },
    },
  });

  const seen = new Set<number>();
  const rows: Array<Record<string, string | number | null>> = [];
  for (const e of events) {
    // One order can log more than one REFUNDED event (e.g. partial then full) —
    // count it once, on its first (most recent, given the ordering) appearance.
    if (seen.has(e.order.orderNumber)) continue;
    seen.add(e.order.orderNumber);
    rows.push({
      refundedOn: e.createdAt.toISOString(),
      order: formatOrderNumber(e.order.orderNumber),
      store: e.order.store.name,
      paidOn: e.order.paidAt ? e.order.paidAt.toISOString() : null,
      payment: PAYMENT_LABEL[e.order.provider] ?? e.order.provider,
      amount: e.order.amount,
      commission: e.order.commissionAmount ?? 0,
    });
  }

  const refundedTotal = rows.reduce((s, r) => s + (r.amount as number), 0);
  const commissionTotal = rows.reduce((s, r) => s + (r.commission as number), 0);
  const storesAffected = new Set(rows.map((r) => r.store)).size;

  return {
    type: 'refunds',
    title: 'Refunds',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Refunds issued', value: rows.length.toLocaleString('en-US') },
      { label: 'Amount refunded', value: usd(refundedTotal) },
      { label: 'Stores affected', value: String(storesAffected) },
      {
        label: 'Avg refund',
        value: rows.length ? usd(Math.round(refundedTotal / rows.length)) : '—',
      },
      { label: 'Commission reversed', value: usd(commissionTotal) },
    ],
    columns: [
      { key: 'refundedOn', label: 'Refunded', format: 'date' },
      { key: 'order', label: 'Order' },
      { key: 'store', label: 'Store' },
      { key: 'paidOn', label: 'Originally paid', format: 'date' },
      { key: 'payment', label: 'Payment' },
      { key: 'amount', label: 'Amount', format: 'usd' },
      { key: 'commission', label: 'Commission on order', format: 'usd' },
    ],
    rows,
    notes: [
      'A refund is counted on the date it was issued, not the date the order was paid.',
      '"Commission on order" is what the platform originally took — for card orders it is refunded automatically; for Cash App / Zelle it is waived or credited on the ledger.',
      events.length >= TAKE
        ? `Truncated to the ${TAKE.toLocaleString('en-US')} most recent refund events.`
        : '',
    ].filter(Boolean),
  };
}
