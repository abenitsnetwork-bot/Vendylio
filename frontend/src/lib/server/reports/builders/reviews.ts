import 'server-only';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

/** Buyer reviews left in the window, rolled up per store. */
export async function buildReviews({ from, to, storeId }: ReportArgs): Promise<ReportData> {
  const where: Prisma.ReviewWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(storeId ? { storeId } : {}),
  };

  const reviews = await prisma.review.findMany({
    where,
    select: {
      storeId: true,
      rating: true,
      text: true,
      visible: true,
      store: { select: { name: true } },
    },
  });

  interface Agg {
    store: string;
    count: number;
    sum: number;
    dist: number[];
    withText: number;
    hidden: number;
  }
  const byStore = new Map<string, Agg>();
  for (const r of reviews) {
    let a = byStore.get(r.storeId);
    if (!a) {
      a = { store: r.store.name, count: 0, sum: 0, dist: [0, 0, 0, 0, 0], withText: 0, hidden: 0 };
      byStore.set(r.storeId, a);
    }
    a.count += 1;
    a.sum += r.rating;
    const idx = Math.min(5, Math.max(1, r.rating)) - 1;
    a.dist[idx] = (a.dist[idx] ?? 0) + 1;
    if (r.text && r.text.trim()) a.withText += 1;
    if (!r.visible) a.hidden += 1;
  }

  const rows = [...byStore.values()]
    .map((a) => ({
      store: a.store,
      reviews: a.count,
      avgRating: a.count > 0 ? Number((a.sum / a.count).toFixed(2)) : 0,
      r5: a.dist[4] ?? 0,
      r4: a.dist[3] ?? 0,
      r3: a.dist[2] ?? 0,
      r2: a.dist[1] ?? 0,
      r1: a.dist[0] ?? 0,
      withText: a.count > 0 ? Number(((a.withText / a.count) * 100).toFixed(0)) : 0,
      hidden: a.hidden,
    }))
    .sort((x, y) => y.reviews - x.reviews);

  const total = reviews.length;
  const avgAll = total > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / total : 0;
  const belowBar = rows.filter((r) => r.reviews >= 3 && r.avgRating < 3.5).length;

  return {
    type: 'reviews',
    title: 'Reviews & ratings',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Reviews', value: total.toLocaleString('en-US') },
      { label: 'Platform avg', value: total ? `${avgAll.toFixed(2)} ★` : '—' },
      { label: 'Stores below 3.5★', value: String(belowBar) },
      { label: 'Stores reviewed', value: String(rows.length) },
    ],
    columns: [
      { key: 'store', label: 'Store' },
      { key: 'reviews', label: 'Reviews', format: 'number' },
      { key: 'avgRating', label: 'Avg ★', format: 'number' },
      { key: 'r5', label: '5★', format: 'number' },
      { key: 'r4', label: '4★', format: 'number' },
      { key: 'r3', label: '3★', format: 'number' },
      { key: 'r2', label: '2★', format: 'number' },
      { key: 'r1', label: '1★', format: 'number' },
      { key: 'withText', label: '% with text', format: 'percent' },
      { key: 'hidden', label: 'Hidden', format: 'number' },
    ],
    rows,
    notes: [
      'Counted by review creation date. One review per order.',
      '"Hidden" reviews are still counted in the averages — they are hidden from the storefront, not deleted.',
    ],
  };
}
