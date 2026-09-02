import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

const TAKE = 5000;
const TERMINAL_OK = 'DELIVERED';
const TERMINAL_BAD = ['CANCELLED', 'FAILED'];
const COURIER_TYPES = ['UBER_DIRECT', 'DOORDASH', 'uber_direct'];

const PROVIDER_LABEL: Record<string, string> = {
  UBER_DIRECT: 'Uber Direct',
  DOORDASH: 'DoorDash',
  MERCHANT: 'Merchant',
  PICKUP: 'Pickup',
  uber_direct: 'Uber Direct',
  self_manual: 'Merchant',
};

/**
 * Every delivery created in the window (courier + merchant self-delivery).
 * One row per delivery: which store, provider, where it ended up, the fee
 * charged to the buyer vs what the provider billed us, dispatch attempts.
 */
export async function buildDeliveries({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.DeliveryWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(storeId ? { order: { storeId } } : {}),
  };

  const deliveries = await prisma.delivery.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: {
      createdAt: true,
      state: true,
      providerType: true,
      provider: true,
      feeCents: true,
      providerCostCents: true,
      attemptCount: true,
      dispatchedAt: true,
      deliveredAt: true,
      order: { select: { orderNumber: true, store: { select: { name: true } } } },
    },
  });

  const rows = deliveries.map((d) => {
    const key = d.providerType ?? d.provider;
    return {
      order: formatOrderNumber(d.order.orderNumber),
      date: d.createdAt.toISOString(),
      store: d.order.store.name,
      provider: PROVIDER_LABEL[key] ?? key,
      state: d.state,
      fee: d.feeCents ?? 0,
      providerCost: d.providerCostCents ?? 0,
      attempts: d.attemptCount,
      dispatched: d.dispatchedAt ? d.dispatchedAt.toISOString() : null,
      delivered: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    };
  });

  const delivered = deliveries.filter((d) => d.state === TERMINAL_OK).length;
  const failed = deliveries.filter((d) => TERMINAL_BAD.includes(d.state)).length;
  const inFlight = deliveries.length - delivered - failed;
  const courier = deliveries.filter((d) =>
    COURIER_TYPES.includes(d.providerType ?? d.provider),
  ).length;
  const feeTotal = rows.reduce((s, r) => s + r.fee, 0);
  const costTotal = rows.reduce((s, r) => s + r.providerCost, 0);

  return {
    type: 'deliveries',
    title: 'Deliveries',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Deliveries', value: deliveries.length.toLocaleString('en-US') },
      { label: 'Delivered', value: delivered.toLocaleString('en-US') },
      { label: 'Failed / cancelled', value: failed.toLocaleString('en-US') },
      { label: 'In flight', value: inFlight.toLocaleString('en-US') },
      { label: 'Courier vs merchant', value: `${courier} / ${deliveries.length - courier}` },
      {
        label: 'Fees charged − provider cost',
        value: usd(feeTotal - costTotal),
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'date', label: 'Created', format: 'date' },
      { key: 'store', label: 'Store' },
      { key: 'provider', label: 'Provider' },
      { key: 'state', label: 'State' },
      { key: 'fee', label: 'Fee charged', format: 'usd' },
      { key: 'providerCost', label: 'Provider cost', format: 'usd' },
      { key: 'attempts', label: 'Attempts', format: 'number' },
      { key: 'dispatched', label: 'Dispatched', format: 'date' },
      { key: 'delivered', label: 'Delivered', format: 'date' },
    ],
    rows,
    notes: [
      'A delivery row is created for every paid non-pickup order; "In flight" includes rows still PENDING dispatch.',
      'Provider cost is modelled but not charged in V1, so it is usually $0.',
      deliveries.length >= TAKE
        ? `Truncated to the ${TAKE.toLocaleString('en-US')} most recent deliveries.`
        : '',
    ].filter(Boolean),
  };
}
