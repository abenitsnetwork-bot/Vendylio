'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';

const menuItems: { icon: IconName; label: string; desc: string; href: string }[] = [
  { icon: 'user', label: 'My Profile', desc: 'View and edit your profile', href: '/settings' },
  {
    icon: 'settings',
    label: 'Settings',
    desc: 'Manage store settings',
    href: '/dashboard/settings',
  },
  {
    icon: 'credit-card',
    label: 'Billing & Payouts',
    desc: 'Payment methods and earnings',
    href: '/dashboard/billing',
  },
  { icon: 'lock', label: 'Security', desc: 'Password and login settings', href: '/settings' },
  {
    icon: 'help-circle',
    label: 'Help & Support',
    desc: 'Guides and resources',
    href: '/dashboard/resources',
  },
];

export function AccountMenu({
  userName,
  userEmail,
  onSignOut,
  onNavigate = () => {},
}: {
  userName: string;
  userEmail: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="w-64 rounded-lg border border-border bg-card py-2 shadow-lg">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground">
            {userName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-semibold text-foreground">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
          </div>
        </div>
      </div>

      <div className="py-2">
        {menuItems.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary"
          >
            <Icon i={item.icon} size={18} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          </Link>
        ))}
        <button
          type="button"
          onClick={onSignOut}
          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary"
        >
          <Icon i="log-out" size={18} className="mt-0.5 flex-shrink-0 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Sign Out</p>
            <p className="text-xs text-muted-foreground">Log out of your account</p>
          </div>
        </button>
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="rounded bg-secondary p-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Store Status</p>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <p className="text-sm font-semibold text-foreground">Live & Selling</p>
          </div>
        </div>
      </div>
    </div>
  );
}
