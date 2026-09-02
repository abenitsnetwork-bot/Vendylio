import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { ReportData } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Snapshot (ignores the date range): every user account currently
 * SUSPENDED, with the store they run (if any) and a rough suspension time.
 */
export async function buildSuspendedAccounts(): Promise<ReportData> {
  const users = await prisma.user.findMany({
    where: { status: 'SUSPENDED' },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
    select: {
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      memberships: {
        select: { organization: { select: { store: { select: { name: true } } } } },
      },
    },
  });

  const rows = users.map((u) => ({
    email: u.email,
    name: u.name ?? '',
    role: u.role,
    store: u.memberships[0]?.organization?.store?.name ?? '',
    joined: u.createdAt.toISOString(),
    suspendedAround: u.updatedAt.toISOString(),
  }));

  const now = Date.now();
  const withStore = rows.filter((r) => r.store).length;
  const staff = users.filter((u) => u.role === 'ADMIN' || u.role === 'SUPERADMIN').length;
  const last30 = users.filter((u) => now - u.updatedAt.getTime() <= 30 * DAY_MS).length;

  return {
    type: 'suspended-accounts',
    title: 'Suspended accounts',
    period: null,
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Suspended accounts', value: String(users.length) },
      { label: 'Running a store', value: String(withStore) },
      { label: 'Staff accounts', value: String(staff) },
      { label: 'Suspended in last 30d', value: String(last30) },
    ],
    columns: [
      { key: 'email', label: 'Email' },
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'store', label: 'Store' },
      { key: 'joined', label: 'Joined', format: 'date' },
      { key: 'suspendedAround', label: 'Suspended (approx.)', format: 'date' },
    ],
    rows,
    notes: [
      'There is no dedicated suspension timestamp — "Suspended (approx.)" is the account’s last-updated time, which is usually the suspension itself.',
      'A SUSPENDED account is refused both login and token refresh (403 ACCOUNT_SUSPENDED). Only a SUPERADMIN can restore it.',
    ],
  };
}
