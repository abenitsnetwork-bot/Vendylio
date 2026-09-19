import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { formatOrderNumber } from '@/lib/orderNumber';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

const TAKE = 5000;

interface DiscrepancyMetadata {
  reason?: string;
  checkoutSessionId?: string;
  paymentIntentId?: string | null;
  stripePaymentStatus?: string;
  orderStatus?: string;
  detectedAt?: string;
}

/**
 * Financial architecture (Phase 2G) — read-only view over the
 * RECONCILIATION_DISCREPANCY FinancialEvents the Phase 2F/2F.1 detector
 * writes (lib/server/payments/reconciliation.ts). Every discrepancy is
 * Stripe reporting `payment_status: 'paid'` while the Order was still
 * PENDING or EXPIRED — this report only surfaces that fact, it never
 * repairs it (no Order/commission/balance write happens here, matching the
 * detector's own detection-only contract).
 */
export async function buildReconciliationDiscrepancies({
  from,
  to,
  storeId,
}: ReportArgs): Promise<ReportData> {
  const where: Prisma.FinancialEventWhereInput = {
    eventType: 'RECONCILIATION_DISCREPANCY',
    createdAt: { gte: from, lt: to },
    ...(storeId ? { storeId } : {}),
  };

  const events = await prisma.financialEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: {
      createdAt: true,
      orderId: true,
      storeId: true,
      amountCents: true,
      currency: true,
      metadata: true,
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

  const rows = events.map((e) => {
    const meta = (e.metadata ?? {}) as DiscrepancyMetadata;
    return {
      detectedOn: e.createdAt.toISOString(),
      order:
        e.orderId && orderNumberById.has(e.orderId)
          ? formatOrderNumber(orderNumberById.get(e.orderId)!)
          : (e.orderId ?? '—'),
      store: e.storeId ? (storeNameById.get(e.storeId) ?? '(deleted store)') : '—',
      orderStatusAtDetection: meta.orderStatus ?? '—',
      amount: e.amountCents ?? 0,
      checkoutSessionId: meta.checkoutSessionId ?? '—',
      paymentIntentId: meta.paymentIntentId ?? null,
    };
  });

  const pendingCount = rows.filter((r) => r.orderStatusAtDetection === 'PENDING').length;
  const expiredCount = rows.filter((r) => r.orderStatusAtDetection === 'EXPIRED').length;
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const affectedOrders = new Set(events.map((e) => e.orderId)).size;

  return {
    type: 'reconciliation-discrepancies',
    title: 'Reconciliation discrepancies',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Discrepancies', value: rows.length.toLocaleString('en-US') },
      { label: 'Affected orders', value: affectedOrders.toLocaleString('en-US') },
      { label: 'Amount involved', value: usd(totalAmount) },
      { label: 'Found while PENDING', value: String(pendingCount) },
      { label: 'Found while EXPIRED', value: String(expiredCount) },
    ],
    columns: [
      { key: 'detectedOn', label: 'Detected', format: 'date' },
      { key: 'order', label: 'Order' },
      { key: 'store', label: 'Store' },
      { key: 'orderStatusAtDetection', label: 'Vendylio status at detection' },
      { key: 'amount', label: 'Amount', format: 'usd' },
      { key: 'checkoutSessionId', label: 'Checkout Session' },
      { key: 'paymentIntentId', label: 'PaymentIntent' },
    ],
    rows,
    notes: [
      'A discrepancy means Stripe reported the Checkout Session as paid while Vendylio still had the Order as PENDING or EXPIRED — almost always a missed or delayed webhook delivery.',
      'This report is detection-only, matching the reconciliation service itself: it never repairs an Order, changes its status, or touches commission/balance.',
      events.length >= TAKE
        ? `Truncated to the ${TAKE.toLocaleString('en-US')} most recent discrepancies.`
        : '',
    ].filter(Boolean),
  };
}
