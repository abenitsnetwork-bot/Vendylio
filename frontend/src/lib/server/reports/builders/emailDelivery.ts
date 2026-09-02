import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

const TAKE = 20000;

/** Normalise a subject into a template key: digits → #, trimmed, capped. */
function templateKey(subject: string): string {
  return subject.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * Transactional email delivery for the window, grouped by normalised
 * subject: sent / failed / dead-lettered counts and the delivery rate.
 */
export async function buildEmailDelivery({ from, to }: ReportArgs): Promise<ReportData> {
  const jobs = await prisma.emailJob.findMany({
    where: { createdAt: { gte: from, lt: to } },
    take: TAKE,
    select: { status: true, attempts: true, subject: true },
  });

  interface Agg {
    template: string;
    total: number;
    sent: number;
    failed: number;
    dead: number;
    pending: number;
    attempts: number;
  }
  const byTemplate = new Map<string, Agg>();
  for (const j of jobs) {
    const t = templateKey(j.subject);
    let a = byTemplate.get(t);
    if (!a) {
      a = { template: t, total: 0, sent: 0, failed: 0, dead: 0, pending: 0, attempts: 0 };
      byTemplate.set(t, a);
    }
    a.total += 1;
    a.attempts += j.attempts;
    if (j.status === 'SENT') a.sent += 1;
    else if (j.status === 'FAILED') a.failed += 1;
    else if (j.status === 'DEAD') a.dead += 1;
    else a.pending += 1;
  }

  const rows = [...byTemplate.values()]
    .map((a) => ({
      template: a.template,
      total: a.total,
      sent: a.sent,
      failed: a.failed,
      dead: a.dead,
      pending: a.pending,
      deliveryRate: a.total > 0 ? Number(((a.sent / a.total) * 100).toFixed(1)) : 0,
      avgAttempts: a.total > 0 ? Number((a.attempts / a.total).toFixed(1)) : 0,
    }))
    .sort((x, y) => y.total - x.total);

  const total = jobs.length;
  const sent = rows.reduce((s, r) => s + r.sent, 0);
  const failed = rows.reduce((s, r) => s + r.failed, 0);
  const dead = rows.reduce((s, r) => s + r.dead, 0);

  return {
    type: 'email-delivery',
    title: 'Email delivery',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Emails queued', value: total.toLocaleString('en-US') },
      { label: 'Delivered', value: total > 0 ? `${((sent / total) * 100).toFixed(1)}%` : '—' },
      { label: 'Failed (retrying)', value: failed.toLocaleString('en-US') },
      { label: 'Dead-lettered', value: dead.toLocaleString('en-US') },
    ],
    columns: [
      { key: 'template', label: 'Template (subject)' },
      { key: 'total', label: 'Queued', format: 'number' },
      { key: 'sent', label: 'Sent', format: 'number' },
      { key: 'failed', label: 'Failed', format: 'number' },
      { key: 'dead', label: 'Dead', format: 'number' },
      { key: 'pending', label: 'Pending', format: 'number' },
      { key: 'deliveryRate', label: 'Delivery rate', format: 'percent' },
      { key: 'avgAttempts', label: 'Avg attempts', format: 'number' },
    ],
    rows,
    notes: [
      'Templates are inferred by normalising the subject (numbers → #). FAILED rows are still being retried by the email-queue cron; DEAD rows exhausted their retries.',
      jobs.length >= TAKE
        ? `Based on the ${TAKE.toLocaleString('en-US')} most recent email jobs in the window.`
        : '',
    ].filter(Boolean),
  };
}
