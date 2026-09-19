import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

const TAKE = 5000;

/**
 * The eventTypes the financial architecture actually writes today (Phase
 * 2D/2E/2F). FinancialEvent.eventType has no DB enum — it's intentionally a
 * free-text column — so this list is documentation + the explorer's filter
 * options, not a schema constraint. Per Phase 2G §11: "Do not add new event
 * types simply for UI convenience" — this is the real, current vocabulary,
 * not the full aspirational list a future phase's event catalogue might add.
 */
export const KNOWN_FINANCIAL_EVENT_TYPES = [
  'PAYMENT_SUCCEEDED',
  'REFUND_COMPLETED',
  'APPLICATION_FEE_CREATED',
  'APPLICATION_FEE_REVERSED',
  'DISPUTE_OPENED',
  'DISPUTE_UPDATED',
  'DISPUTE_CLOSED',
  'STRIPE_FEE_RECORDED',
  'RECONCILIATION_DISCREPANCY',
] as const;

/**
 * Financial architecture (Phase 2G) — read-only Financial Event Explorer
 * over the append-only FinancialEvent ledger (Phase 2A). Filterable by date
 * range, store, and (only this report) eventType / provider / sourceType /
 * sourceId / orderId — see ReportArgs. This is a raw audit view: it does
 * not aggregate business meaning across event types (a PAYMENT_SUCCEEDED
 * row and a STRIPE_FEE_RECORDED row for the same Order are NOT netted
 * against each other here — see FinancialEvent's own model comment: it is
 * an audit ledger, not a second source of truth to sum for a P&L).
 */
export async function buildFinancialEvents({
  from,
  to,
  storeId,
  eventType,
  provider,
  sourceType,
  sourceId,
  orderId,
}: ReportArgs): Promise<ReportData> {
  const where: Prisma.FinancialEventWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(storeId ? { storeId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(provider ? { provider } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(orderId ? { orderId } : {}),
  };

  const events = await prisma.financialEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: {
      id: true,
      eventType: true,
      sourceType: true,
      sourceId: true,
      storeId: true,
      orderId: true,
      amountCents: true,
      currency: true,
      provider: true,
      externalId: true,
      createdAt: true,
    },
  });

  const storeIds = [
    ...new Set(events.map((e) => e.storeId).filter((v): v is string => v !== null)),
  ];
  const orderIds = [
    ...new Set(events.map((e) => e.orderId).filter((v): v is string => v !== null)),
  ];
  const [stores, orders] = await Promise.all([
    storeIds.length
      ? prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    orderIds.length
      ? prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNumber: true },
        })
      : Promise.resolve([]),
  ]);
  const storeNameById = new Map(stores.map((s) => [s.id, s.name]));
  const orderNumberById = new Map(orders.map((o) => [o.id, o.orderNumber]));

  const rows = events.map((e) => ({
    date: e.createdAt.toISOString(),
    eventType: e.eventType,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    order:
      e.orderId && orderNumberById.has(e.orderId)
        ? formatOrderNumber(orderNumberById.get(e.orderId)!)
        : (e.orderId ?? '—'),
    store: e.storeId ? (storeNameById.get(e.storeId) ?? '(deleted store)') : '—',
    amount: e.amountCents,
    currency: e.currency,
    provider: e.provider ?? '—',
    externalId: e.externalId ?? '—',
  }));

  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.eventType, (byType.get(e.eventType) ?? 0) + 1);
  const topTypes = [...byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, c]) => `${t} (${c})`)
    .join(', ');

  return {
    type: 'financial-events',
    title: 'Financial event explorer',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Events', value: events.length.toLocaleString('en-US') },
      { label: 'Distinct event types', value: String(byType.size) },
      { label: 'Most common', value: topTypes || '—' },
      {
        label: 'Net amount',
        value: usd(events.reduce((s, e) => s + (e.amountCents ?? 0), 0)),
      },
    ],
    columns: [
      { key: 'date', label: 'Date', format: 'date' },
      { key: 'eventType', label: 'Event type' },
      { key: 'sourceType', label: 'Source type' },
      { key: 'sourceId', label: 'Source ID' },
      { key: 'order', label: 'Order' },
      { key: 'store', label: 'Store' },
      { key: 'amount', label: 'Amount', format: 'usd' },
      { key: 'currency', label: 'Currency' },
      { key: 'provider', label: 'Provider' },
      { key: 'externalId', label: 'External ID' },
    ],
    rows,
    notes: [
      'FinancialEvent is an append-only audit ledger, not a second source of truth — amounts across different event types are not meant to be summed into a P&L here.',
      'This is a raw audit view. It never writes to any record — filter, inspect, export.',
      events.length >= TAKE
        ? `Truncated to the ${TAKE.toLocaleString('en-US')} most recent events.`
        : '',
    ].filter(Boolean),
  };
}
