import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { usd } from '../format';

const DEAD_AFTER_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Snapshot (ignores the date range): ACTIVE products with stock on hand that
 * have not sold a single unit in the last 60 days — capital sitting still.
 */
export async function buildDeadStock({ storeId }: ReportArgs): Promise<ReportData> {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', quantity: { gt: 0 }, ...(storeId ? { storeId } : {}) },
    select: {
      id: true,
      name: true,
      priceCents: true,
      quantity: true,
      createdAt: true,
      store: { select: { name: true } },
    },
  });

  const activeWithStock = products.length;
  const ids = products.map((p) => p.id);

  const lastSaleGroups = ids.length
    ? await prisma.stockMovement.groupBy({
        by: ['productId'],
        where: { reason: 'SALE', productId: { in: ids } },
        _max: { createdAt: true },
      })
    : [];
  const lastSale = new Map(lastSaleGroups.map((g) => [g.productId, g._max.createdAt ?? null]));

  const now = Date.now();
  const cutoff = now - DEAD_AFTER_DAYS * DAY_MS;

  const rows = products
    .filter((p) => {
      const ls = lastSale.get(p.id);
      return !ls || ls.getTime() < cutoff;
    })
    .map((p) => {
      const ls = lastSale.get(p.id) ?? null;
      return {
        store: p.store.name,
        product: p.name,
        onHand: Math.round(p.quantity * 100) / 100,
        stockValue: Math.round(p.priceCents * p.quantity),
        lastSold: ls ? ls.toISOString() : null,
        daysSinceSale: ls ? Math.floor((now - ls.getTime()) / DAY_MS) : null,
        ageDays: Math.floor((now - p.createdAt.getTime()) / DAY_MS),
      };
    })
    .sort((a, b) => b.stockValue - a.stockValue);

  const capitalTied = rows.reduce((s, r) => s + r.stockValue, 0);
  const neverSold = rows.filter((r) => r.lastSold === null).length;

  return {
    type: 'dead-stock',
    title: 'Dead stock',
    period: null,
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Dead SKUs', value: rows.length.toLocaleString('en-US') },
      {
        label: '% of active w/ stock',
        value: activeWithStock ? `${((rows.length / activeWithStock) * 100).toFixed(1)}%` : '—',
      },
      { label: 'Capital tied up', value: usd(capitalTied) },
      { label: 'Never sold', value: String(neverSold) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'product', label: 'Product' },
      { key: 'onHand', label: 'On hand', format: 'number' },
      { key: 'stockValue', label: 'Stock value', format: 'usd' },
      { key: 'lastSold', label: 'Last sold', format: 'date' },
      { key: 'daysSinceSale', label: 'Days since sale', format: 'number' },
      { key: 'ageDays', label: 'Product age (days)', format: 'number' },
    ],
    rows,
    notes: [
      `"Dead" = an ACTIVE product with quantity > 0 and no SALE stock movement in the last ${DEAD_AFTER_DAYS} days.`,
      'Stock value is on-hand quantity × current price (product-level; variant prices are not itemised here).',
    ],
  };
}
