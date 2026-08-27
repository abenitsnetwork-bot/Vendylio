'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AdminProvider, useAdminAuth } from '@/contexts/AdminContext';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { Icon } from '@/components/ui/Icon';

function AdminGate({ children }: { children: React.ReactNode }) {
  const { admin, loading, error, refresh } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (error === 'UNAUTHENTICATED') router.replace('/login');
  }, [error, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error === 'FORBIDDEN') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <Icon i="shield" size={32} className="text-muted-foreground" />
        <div>
          <p className="mb-1 font-headings text-lg font-bold text-foreground">Access denied</p>
          <p className="text-sm text-muted-foreground">
            This account doesn&apos;t have admin access.
          </p>
        </div>
        <a href="/dashboard" className="text-sm font-medium text-primary">
          Back to your dashboard
        </a>
      </div>
    );
  }

  if (error === 'NETWORK') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm text-red-600">Could not reach the server.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-sm font-medium text-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!admin) return null; // redirecting to /login

  return (
    <div className="min-h-screen bg-background">
      <AdminSidebar />
      <div className="pb-16 lg:pb-0 lg:pl-56">
        <AdminHeader admin={admin} />
        {children}
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <AdminGate>{children}</AdminGate>
    </AdminProvider>
  );
}
