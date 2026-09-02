import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportData } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Snapshot (ignores the date range): everyone on the "Business" tier
 * waitlist captured from the /pricing teaser, newest first.
 */
export async function buildBusinessWaitlist(): Promise<ReportData> {
  const leads = await prisma.businessLead.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5000,
    select: { email: true, storeName: true, note: true, createdAt: true },
  });

  const rows = leads.map((l) => ({
    joined: l.createdAt.toISOString(),
    email: l.email,
    store: l.storeName ?? '',
    note: l.note ?? '',
  }));

  const now = Date.now();
  const last30 = leads.filter((l) => now - l.createdAt.getTime() <= 30 * DAY_MS).length;
  const withNote = leads.filter((l) => l.note && l.note.trim()).length;

  return {
    type: 'business-waitlist',
    title: 'Business waitlist',
    period: null,
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Total leads', value: String(leads.length) },
      { label: 'Last 30 days', value: String(last30) },
      { label: 'Left a note', value: String(withNote) },
    ],
    columns: [
      { key: 'joined', label: 'Joined', format: 'date' },
      { key: 'email', label: 'Email' },
      { key: 'store', label: 'Store name' },
      { key: 'note', label: 'Note' },
    ],
    rows,
    notes: [
      'Captured by the public /pricing "Business" teaser. One row per email (the route dedupes).',
      leads.length >= 5000 ? 'Truncated to the 5,000 most recent leads.' : '',
    ].filter(Boolean),
  };
}
