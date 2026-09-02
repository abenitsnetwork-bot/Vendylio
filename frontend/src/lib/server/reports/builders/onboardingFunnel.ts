import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { PAID_ORDER_STATUSES } from '@/lib/server/orders/paidStatuses';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

/**
 * Activation funnel for stores CREATED in the window: how far each cohort
 * got — added a product, configured a payment method, published, took a
 * first paid order. One row per funnel step with reach % and drop-off.
 */
export async function buildOnboardingFunnel({ from, to }: ReportArgs): Promise<ReportData> {
  const stores = await prisma.store.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: {
      id: true,
      createdAt: true,
      published: true,
      publishedAt: true,
      stripeOnboardingStatus: true,
      cashAppCashtag: true,
      zelleContact: true,
    },
  });

  const ids = stores.map((s) => s.id);
  const [products, paidOrders] = await Promise.all([
    prisma.product.findMany({ where: { storeId: { in: ids } }, select: { storeId: true } }),
    prisma.order.findMany({
      where: { storeId: { in: ids }, status: { in: [...PAID_ORDER_STATUSES] } },
      select: { storeId: true },
    }),
  ]);

  const hasProduct = new Set(products.map((p) => p.storeId));
  const hasOrder = new Set(paidOrders.map((o) => o.storeId));

  const created = stores.length;
  const withProduct = stores.filter((s) => hasProduct.has(s.id)).length;
  const withPayments = stores.filter(
    (s) => s.stripeOnboardingStatus === 'ACTIVE' || s.cashAppCashtag || s.zelleContact,
  ).length;
  const published = stores.filter((s) => s.published).length;
  const withOrder = stores.filter((s) => hasOrder.has(s.id)).length;

  const steps = [
    { step: 'Created a store', count: created },
    { step: 'Added a product', count: withProduct },
    { step: 'Set up a payment method', count: withPayments },
    { step: 'Published the storefront', count: published },
    { step: 'Took a first paid order', count: withOrder },
  ];

  const rows = steps.map((s, i) => ({
    step: s.step,
    stores: s.count,
    ofCreated: created ? Number(((s.count / created) * 100).toFixed(1)) : 0,
    dropFromPrev: i === 0 ? 0 : Math.max(0, (steps[i - 1]?.count ?? 0) - s.count),
  }));

  const publishDays = stores
    .filter((s) => s.publishedAt)
    .map((s) => (s.publishedAt!.getTime() - s.createdAt.getTime()) / 86_400_000)
    .sort((a, b) => a - b);
  const medianPublishDays = publishDays.length
    ? publishDays[Math.floor(publishDays.length / 2)]!.toFixed(1)
    : '—';

  return {
    type: 'onboarding-funnel',
    title: 'Onboarding funnel',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Stores created', value: String(created) },
      { label: 'Published', value: String(published) },
      { label: 'First paid order', value: String(withOrder) },
      {
        label: 'Activation rate',
        value: created ? `${((withOrder / created) * 100).toFixed(1)}%` : '—',
      },
      { label: 'Median days to publish', value: medianPublishDays },
    ],
    columns: [
      { key: 'step', label: 'Step' },
      { key: 'stores', label: 'Stores', format: 'number' },
      { key: 'ofCreated', label: '% of created', format: 'percent' },
      { key: 'dropFromPrev', label: 'Drop from previous step', format: 'number' },
    ],
    rows,
    notes: [
      'Cohort = stores whose creation date falls inside the window. Each step reflects the store’s CURRENT state, so a store that later unpublished lowers the "Published" count.',
      'Steps are not strictly sequential — a store can reach a later step without a visible earlier one.',
    ],
  };
}
