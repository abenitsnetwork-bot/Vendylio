'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminProvider, useAdminAuth, type AdminInfo } from '@/contexts/AdminContext';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';

// The admin layout (a server component) has already verified this request
// belongs to an ADMIN/SUPERADMIN — it calls `notFound()` otherwise. So this
// shell never gates access; it only renders the chrome and provides the
// client-side capability hints (`can[]` from GET /api/admin/me) for
// conditional UI. `serverAdmin` seeds the header so there's no auth flash
// while AdminProvider does its own probe for the capability list.
function Chrome({ serverAdmin, children }: { serverAdmin: AdminInfo; children: React.ReactNode }) {
  const { admin, error, refresh } = useAdminAuth();
  const router = useRouter();
  const shown = admin ?? serverAdmin;

  // The server layout already authorized this render. If the client probe
  // later comes back unauthenticated (session died mid-visit), fall back to
  // the login flow rather than showing a stale shell.
  useEffect(() => {
    if (error === 'UNAUTHENTICATED') router.replace('/login');
  }, [error, router]);

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />
      <div className="pb-16 lg:pb-0 lg:pl-56">
        <AdminHeader admin={shown} />
        {error === 'NETWORK' && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 lg:px-8">
            <span>Couldn&apos;t refresh admin permissions.</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="font-semibold underline"
            >
              Retry
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function AdminShell({ admin, children }: { admin: AdminInfo; children: React.ReactNode }) {
  return (
    <AdminProvider>
      <Chrome serverAdmin={admin}>{children}</Chrome>
    </AdminProvider>
  );
}
