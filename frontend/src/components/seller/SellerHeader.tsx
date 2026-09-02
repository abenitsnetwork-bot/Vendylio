'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { AccountMenu } from '@/components/seller/AccountMenu';
import { NotificationBell } from '@/components/seller/NotificationBell';

/** Shared header for authenticated /dashboard/* pages — logo, notifications,
 * and the account dropdown (profile, settings, billing, security, sign out). */
export function SellerHeader({
  userName,
  userEmail,
  onSignOut,
}: {
  userName: string;
  userEmail: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-border bg-card px-4 py-4 lg:px-14">
      <Link href="/dashboard" className="flex items-center">
        <img src="/logo.png" alt="Vendylio" className="h-9 w-auto" />
      </Link>
      <div className="flex items-center gap-6">
        <NotificationBell />
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
            aria-label="Account menu"
            aria-expanded={open}
          >
            {userName.charAt(0).toUpperCase()}
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-2">
              <AccountMenu
                userName={userName}
                userEmail={userEmail}
                onSignOut={onSignOut}
                onNavigate={() => setOpen(false)}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
