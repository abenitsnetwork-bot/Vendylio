import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportArgs, ReportData } from '../types';
import { periodLabel } from '../format';

/**
 * Every message submitted through the public /contact form in the window.
 */
export async function buildContactMessages({ from, to }: ReportArgs): Promise<ReportData> {
  const messages = await prisma.contactMessage.findMany({
    where: { createdAt: { gte: from, lt: to } },
    orderBy: { createdAt: 'desc' },
    take: 5000,
    select: { name: true, email: true, topic: true, message: true, createdAt: true },
  });

  const rows = messages.map((m) => ({
    date: m.createdAt.toISOString(),
    name: m.name,
    email: m.email,
    topic: m.topic ?? '',
    message: m.message,
  }));

  const withTopic = messages.filter((m) => m.topic && m.topic.trim()).length;

  return {
    type: 'contact-messages',
    title: 'Contact messages',
    period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel(from, to) },
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Messages', value: String(messages.length) },
      { label: 'With a topic selected', value: String(withTopic) },
    ],
    columns: [
      { key: 'date', label: 'Submitted', format: 'date' },
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'topic', label: 'Topic' },
      { key: 'message', label: 'Message' },
    ],
    rows,
    notes: [
      'Submitted through the public /contact form.',
      messages.length >= 5000 ? 'Truncated to the 5,000 most recent messages.' : '',
    ].filter(Boolean),
  };
}
