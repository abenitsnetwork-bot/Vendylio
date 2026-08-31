import { notFound } from 'next/navigation';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { AdminShell } from './AdminShell';

// SERVER-SIDE admin gate. Every /admin/* page renders through this layout,
// so a non-admin (or signed-out) request gets `notFound()` — a real 404,
// indistinguishable from a route that doesn't exist. The old client-only
// gate still shipped the admin HTML shell to everyone and only *then* said
// "Access denied"; this makes the back-office undiscoverable.
//
// `requireAdmin` re-reads the role from the DB (not the JWT), so a
// just-revoked admin loses access on the very next navigation. The edge
// middleware (`src/middleware.ts`) is a cheap pre-filter that 404s anonymous
// requests before this even runs.
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAdmin('ADMIN');
  if (auth instanceof NextResponse) notFound();

  // requireAdmin('ADMIN') has filtered USER away — narrow for AdminInfo.
  const admin = { ...auth.admin, role: auth.admin.role as 'ADMIN' | 'SUPERADMIN' };
  return <AdminShell admin={admin}>{children}</AdminShell>;
}
