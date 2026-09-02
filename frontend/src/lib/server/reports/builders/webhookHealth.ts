import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

const TAKE = 20000;

/**
 * Inbound webhook processing health for the window, grouped by provider +
 * event type: received, processed, still unprocessed, and the median time
 * from receipt to processing.
 */
export async function buildWebhookHealth({ from, to }: ReportArgs): Promise<ReportData> {
  const logs = await prisma.webhookLog.findMany({
    where: { createdAt: { gte: from, lt: to } },
    take: TAKE,
    select: { provider: true, eventType: true, processedAt: true, createdAt: true },
  });

  interface Agg {
    provider: string;
    eventType: string;
    received: number;
    processed: number;
    lags: number[];
  }
  const byKey = new Map<string, Agg>();
  for (const l of logs) {
    const k = `${l.provider} ${l.eventType}`;
    let a = byKey.get(k);
    if (!a) {
      a = { provider: l.provider, eventType: l.eventType, received: 0, processed: 0, lags: [] };
      byKey.set(k, a);
    }
    a.received += 1;
    if (l.processedAt) {
      a.processed += 1;
      a.lags.push((l.processedAt.getTime() - l.createdAt.getTime()) / 1000);
    }
  }

  const median = (xs: number[]): number => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return Math.round((s[Math.floor(s.length / 2)] ?? 0) * 10) / 10;
  };

  const rows = [...byKey.values()]
    .map((a) => ({
      provider: a.provider,
      eventType: a.eventType,
      received: a.received,
      processed: a.processed,
      unprocessed: a.received - a.processed,
      processedPct: a.received > 0 ? Number(((a.processed / a.received) * 100).toFixed(1)) : 0,
      medianLagSec: median(a.lags),
    }))
    .sort((x, y) => y.unprocessed - x.unprocessed || y.received - x.received);

  const totalReceived = rows.reduce((s, r) => s + r.received, 0);
  const totalProcessed = rows.reduce((s, r) => s + r.processed, 0);
  const stuck = totalReceived - totalProcessed;

  return {
    type: 'webhook-health',
    title: 'Webhook health',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Events received', value: totalReceived.toLocaleString('en-US') },
      {
        label: 'Processed',
        value: totalReceived > 0 ? `${((totalProcessed / totalReceived) * 100).toFixed(1)}%` : '—',
      },
      { label: 'Unprocessed', value: stuck.toLocaleString('en-US') },
      { label: 'Providers', value: String(new Set(rows.map((r) => r.provider)).size) },
    ],
    columns: [
      { key: 'provider', label: 'Provider' },
      { key: 'eventType', label: 'Event type' },
      { key: 'received', label: 'Received', format: 'number' },
      { key: 'processed', label: 'Processed', format: 'number' },
      { key: 'unprocessed', label: 'Unprocessed', format: 'number' },
      { key: 'processedPct', label: 'Processed %', format: 'percent' },
      { key: 'medianLagSec', label: 'Median lag (s)', format: 'number' },
    ],
    rows,
    notes: [
      'An "unprocessed" row has no processedAt — either an idempotent duplicate that was accepted-and-ignored, or a genuine failure worth investigating.',
      logs.length >= TAKE
        ? `Based on the ${TAKE.toLocaleString('en-US')} most recent webhook rows in the window.`
        : '',
    ].filter(Boolean),
  };
}
