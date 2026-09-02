import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

const TAKE = 5000;

/** The append-only stock ledger for the window — one row per movement. */
export async function buildStockMovements({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.StockMovementWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(storeId ? { storeId } : {}),
  };

  const movements = await prisma.stockMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: TAKE,
    select: {
      createdAt: true,
      delta: true,
      resultingQuantity: true,
      reason: true,
      actorType: true,
      note: true,
      product: { select: { name: true } },
      store: { select: { name: true } },
    },
  });

  const rows = movements.map((m) => ({
    date: m.createdAt.toISOString(),
    store: m.store.name,
    product: m.product.name,
    reason: m.reason,
    delta: Math.round(m.delta * 100) / 100,
    resulting: Math.round(m.resultingQuantity * 100) / 100,
    actor: m.actorType,
    note: m.note ?? '',
  }));

  const unitsIn = rows.reduce((s, r) => s + (r.delta > 0 ? r.delta : 0), 0);
  const unitsOut = rows.reduce((s, r) => s + (r.delta < 0 ? -r.delta : 0), 0);
  const manual = rows.filter((r) => r.actor === 'SELLER').length;

  return {
    type: 'stock-movements',
    title: 'Stock movements',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Movements', value: movements.length.toLocaleString('en-US') },
      { label: 'Units in', value: (Math.round(unitsIn * 100) / 100).toLocaleString('en-US') },
      { label: 'Units out', value: (Math.round(unitsOut * 100) / 100).toLocaleString('en-US') },
      { label: 'Manual adjustments', value: String(manual) },
    ],
    columns: [
      { key: 'date', label: 'When', format: 'date' },
      { key: 'store', label: 'Store' },
      { key: 'product', label: 'Product' },
      { key: 'reason', label: 'Reason' },
      { key: 'delta', label: 'Change', format: 'number' },
      { key: 'resulting', label: 'Resulting qty', format: 'number' },
      { key: 'actor', label: 'By' },
      { key: 'note', label: 'Note' },
    ],
    rows,
    notes: [
      'Reasons: SALE (paid order), REFUND_RESTOCK, RESTOCK / MANUAL_ADJUST / CORRECTION (seller edits).',
      movements.length >= TAKE
        ? `Truncated to the ${TAKE.toLocaleString('en-US')} most recent movements.`
        : '',
    ].filter(Boolean),
  };
}
