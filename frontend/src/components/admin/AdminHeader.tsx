'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { MobileNavTrigger } from '@/components/nav/MobileNav';
import type { AdminInfo } from '@/contexts/AdminContext';

export function AdminHeader({ admin }: { admin: AdminInfo }) {
  const { logout } = useAuth();
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-4 lg:px-8">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNavTrigger className="-ml-2" />
        <p className="truncate text-sm text-muted-foreground">
          <span className="hidden sm:inline">Signed in as </span>
          <span className="font-medium text-foreground">{admin.email}</span>
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <span className="hidden rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-accent sm:inline">
          {admin.role}
        </span>
        <button
          type="button"
          onClick={async () => {
            await logout();
            router.push('/login');
          }}
          aria-label="Sign out"
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <Icon i="log-out" size={16} />
          Sign Out
        </button>
      </div>
    </header>
  );
}
