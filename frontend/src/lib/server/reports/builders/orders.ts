import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { formatOrderNumber } from '@/lib/orderNumber';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel, usd } from '../format';

const DEAD_STATUSES = ['EXPIRED', 'FAILED', 'CANCELLED'];
const TAKE = 5000;

const PAYMENT_LABEL: Record<string, string> = {
  stripe_platform: 'Card',
  stripe_connect: 'Card (Connect)',
  cashapp_manual: 'Cash App',
  zelle_manual: 'Zelle',
};

/**
 * Every checkout created in the window — one row per order, regardless of
 * payment outcome. Answers "how many orders, how many paid, what did buyers
 * abandon" across the platform (or one store).
 *
 * Phase 2G (§13/§24): adds the full frozen financial breakdown per order —
 * taxable base, commission rate/amount, net amount, Stripe fee, PaymentIntent
 * / Checkout Session ids, refund status, dispute status. All read from the
 * Order row itself (or a Dispute join) — nothing here recalculates or
 * overwrites anything.
 */
export async function buildOrders({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.OrderWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(storeId ? { storeId } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      storeId: true,
      status: true,
      provider: true,
      fulfillmentMethod: true,
      subtotalCents: true,
      deliveryFeeCents: true,
      discountCents: true,
      amount: true,
      taxableAmountCents: true,
      commissionRateBp: true,
      commissionAmount: true,
      netAmount: true,
      stripeFeeCents: true,
      stripePaymentIntentId: true,
      providerChargeId: true,
    },
  });

  const storeIds = [...new Set(orders.map((o) => o.storeId))];
  const orderIds = orders.map((o) => o.id);
  const [stores, disputes] = await Promise.all([
    storeIds.length
      ? prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    orderIds.length
      ? prisma.dispute.findMany({
          where: { orderId: { in: orderIds } },
          orderBy: { createdAt: 'desc' },
          select: { orderId: true, status: true },
        })
      : Promise.resolve([]),
  ]);
  const nameById = new Map(stores.map((s) => [s.id, s.name]));
  // One row per order — an order re-disputed more than once (rare) keeps
  // only its most recent dispute status, matching the `orderBy` above.
  const disputeStatusByOrder = new Map<string, string>();
  for (const d of disputes) {
    if (!disputeStatusByOrder.has(d.orderId)) disputeStatusByOrder.set(d.orderId, d.status);
  }

  const rows = orders.map((o) => ({
    order: formatOrderNumber(o.orderNumber),
    date: o.createdAt.toISOString(),
    store: nameById.get(o.storeId) ?? '(deleted store)',
    status: o.status,
    payment: PAYMENT_LABEL[o.provider] ?? o.provider,
    fulfillment: o.fulfillmentMethod,
    subtotal: o.subtotalCents,
    delivery: o.deliveryFeeCents,
    discount: o.discountCents,
    total: o.amount,
    taxableAmount: o.taxableAmountCents,
    commissionRate: o.commissionRateBp !== null ? o.commissionRateBp / 100 : null,
    commission: o.commissionAmount,
    netAmount: o.netAmount,
    stripeFee: o.stripeFeeCents,
    paymentIntentId: o.stripePaymentIntentId,
    checkoutSessionId: o.providerChargeId,
    refundStatus: o.status === 'REFUNDED' ? 'REFUNDED' : 'NOT_REFUNDED',
    disputeStatus: disputeStatusByOrder.get(o.id) ?? 'NONE',
  }));

  const paid = orders.filter((o) => (PAID_ORDER_STATUSES as readonly string[]).includes(o.status));
  const dead = orders.filter((o) => DEAD_STATUSES.includes(o.status));
  const pending = orders.filter((o) => o.status === 'PENDING');
  const grossPaid = paid.reduce((s, o) => s + o.amount, 0);

  return {
    type: 'orders',
    title: 'Orders',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Orders placed', value: orders.length.toLocaleString('en-US') },
      { label: 'Paid', value: paid.length.toLocaleString('en-US') },
      { label: 'Gross paid', value: usd(grossPaid) },
      {
        label: 'Checkout conversion',
        value: orders.length ? `${((paid.length / orders.length) * 100).toFixed(1)}%` : '—',
      },
      {
        label: 'Abandoned / failed',
        value: (dead.length + pending.length).toLocaleString('en-US'),
      },
    ],
    columns: [
      { key: 'order', label: 'Order' },
      { key: 'date', label: 'Placed', format: 'date' },
      { key: 'store', label: 'Store' },
      { key: 'status', label: 'Status' },
      { key: 'payment', label: 'Payment' },
      { key: 'fulfillment', label: 'Fulfillment' },
      { key: 'subtotal', label: 'Subtotal', format: 'usd' },
      { key: 'delivery', label: 'Delivery', format: 'usd' },
      { key: 'discount', label: 'Discount', format: 'usd' },
      { key: 'total', label: 'Total', format: 'usd' },
      { key: 'taxableAmount', label: 'Taxable amount', format: 'usd' },
      { key: 'commissionRate', label: 'Commission rate', format: 'percent' },
      { key: 'commission', label: 'Commission', format: 'usd' },
      { key: 'netAmount', label: 'Net amount', format: 'usd' },
      { key: 'stripeFee', label: 'Stripe fee', format: 'usd' },
      { key: 'paymentIntentId', label: 'PaymentIntent' },
      { key: 'checkoutSessionId', label: 'Checkout Session' },
      { key: 'refundStatus', label: 'Refund status' },
      { key: 'disputeStatus', label: 'Dispute status' },
    ],
    rows,
    notes: [
      'Listed by the date the checkout was created, regardless of payment outcome. A PENDING row may still convert.',
      'Taxable amount, commission rate/amount, and net amount are the values frozen on the Order at checkout (Phase 2B) — never recalculated. They are null for an order that predates that freeze.',
      'Stripe fee is null until Stripe’s Balance Transaction has been captured (Phase 2D) — never estimated.',
      'Dispute status is the most recent dispute on the order, or NONE if it has never been disputed.',
      orders.length >= TAKE
        ? `Truncated to the ${TAKE.toLocaleString('en-US')} most recent orders.`
        : '',
    ].filter(Boolean),
  };
}
