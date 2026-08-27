'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { AccountMenu } from '@/components/seller/AccountMenu';

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
      <Link href="/dashboard" className="font-headings text-xl font-bold text-foreground">
        Vendylio
      </Link>
      <div className="flex items-center gap-6">
        <button
          type="button"
          className="flex items-center gap-2 text-muted-foreground"
          aria-label="Notifications"
        >
          <Icon i="bell" size={18} />
        </button>
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
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
