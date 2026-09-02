import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { usd } from '../format';

/**
 * Snapshot (ignores the date range): on-hand inventory valued at retail, per
 * store — active SKUs, units, retail value, and how many are low / out of
 * stock against each product's effective threshold.
 */
export async function buildInventoryValuation({ storeId }: ReportArgs): Promise<ReportData> {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', ...(storeId ? { storeId } : {}) },
    select: {
      storeId: true,
      priceCents: true,
      quantity: true,
      lowStockThreshold: true,
      store: { select: { name: true, defaultLowStockThreshold: true } },
      variants: { select: { quantity: true, priceDeltaCents: true } },
    },
  });

  interface Agg {
    store: string;
    skus: number;
    units: number;
    value: number;
    low: number;
    out: number;
  }
  const byStore = new Map<string, Agg>();

  for (const p of products) {
    let a = byStore.get(p.storeId);
    if (!a) {
      a = { store: p.store.name, skus: 0, units: 0, value: 0, low: 0, out: 0 };
      byStore.set(p.storeId, a);
    }
    a.skus += 1;

    let units: number;
    let value: number;
    if (p.variants.length) {
      units = p.variants.reduce((s, v) => s + v.quantity, 0);
      value = p.variants.reduce(
        (s, v) => s + Math.round((p.priceCents + v.priceDeltaCents) * v.quantity),
        0,
      );
    } else {
      units = p.quantity;
      value = Math.round(p.priceCents * p.quantity);
    }
    a.units += units;
    a.value += value;

    const threshold = p.lowStockThreshold ?? p.store.defaultLowStockThreshold;
    if (units <= 0) a.out += 1;
    else if (units <= threshold) a.low += 1;
  }

  const rows = [...byStore.values()]
    .map((a) => ({
      store: a.store,
      skus: a.skus,
      units: Math.round(a.units * 100) / 100,
      retailValue: a.value,
      lowStock: a.low,
      outOfStock: a.out,
    }))
    .sort((x, y) => y.retailValue - x.retailValue);

  const totalValue = rows.reduce((s, r) => s + r.retailValue, 0);
  const totalSkus = rows.reduce((s, r) => s + r.skus, 0);
  const totalLow = rows.reduce((s, r) => s + r.lowStock, 0);
  const totalOut = rows.reduce((s, r) => s + r.outOfStock, 0);

  return {
    type: 'inventory-valuation',
    title: 'Inventory valuation',
    period: null,
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Total retail value', value: usd(totalValue) },
      { label: 'Active SKUs', value: totalSkus.toLocaleString('en-US') },
      { label: 'Low stock', value: String(totalLow) },
      { label: 'Out of stock', value: String(totalOut) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'skus', label: 'Active SKUs', format: 'number' },
      { key: 'units', label: 'Units on hand', format: 'number' },
      { key: 'retailValue', label: 'Retail value', format: 'usd' },
      { key: 'lowStock', label: 'Low stock', format: 'number' },
      { key: 'outOfStock', label: 'Out of stock', format: 'number' },
    ],
    rows,
    notes: [
      'Retail value = on-hand quantity × price (variant price deltas included when a product has variants).',
      'Low / out is measured against each product’s threshold (its own, or the store default).',
    ],
  };
}
