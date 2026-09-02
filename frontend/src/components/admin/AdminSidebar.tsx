'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useAdminAuth } from '@/contexts/AdminContext';
import { MobileNavDrawer } from '@/components/nav/MobileNav';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: 'home' },
  { href: '/admin/users', label: 'Users', icon: 'users' },
  { href: '/admin/stores', label: 'Stores', icon: 'store' },
  { href: '/admin/orders', label: 'Orders', icon: 'shopping-bag' },
  { href: '/admin/withdrawals', label: 'Withdrawals', icon: 'credit-card' },
  { href: '/admin/commission', label: 'Commission', icon: 'dollar-sign' },
  { href: '/admin/audit-log', label: 'Audit Log', icon: 'clipboard' },
];

// Landing-page CMS and platform Settings are SUPERADMIN-only (not part of
// the locked ADMIN/SUPERADMIN `can[]` capability contract in
// api/admin/me/route.ts — gated purely on role here, same as the
// last-SUPERADMIN guard elsewhere in the back office).
const SUPERADMIN_NAV_ITEMS: NavItem[] = [
  { href: '/admin/reports', label: 'Reports', icon: 'bar-chart-3' },
  { href: '/admin/site-content', label: 'Site Content', icon: 'image' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
];

// Phone bottom bar — the four destinations an operator hits daily. The rest
// (Users, Commission, Audit Log, Site Content, Settings) live in the "Menu"
// drawer, opened from the header.
const MOBILE_NAV_HREFS = ['/admin', '/admin/stores', '/admin/orders', '/admin/withdrawals'];

function isActive(pathname: string, href: string): boolean {
  return href === '/admin' ? pathname === href : pathname.startsWith(href);
}

/** Same fixed-sidebar / mobile-bottom-bar pattern as SellerSidebar (Phase 9). */
export function AdminSidebar() {
  const pathname = usePathname();
  const { admin } = useAdminAuth();
  const items = admin?.role === 'SUPERADMIN' ? [...NAV_ITEMS, ...SUPERADMIN_NAV_ITEMS] : NAV_ITEMS;
  const mobileItems = MOBILE_NAV_HREFS.map((href) => items.find((i) => i.href === href)).filter(
    (i): i is NavItem => Boolean(i),
  );

  return (
    <>
      {/* Full nav — the "Menu" drawer (phone only, opened from the header) */}
      <MobileNavDrawer
        items={items}
        homeHref="/admin"
        title="Admin"
        footer={
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
          >
            <Icon i="arrow-left" size={18} />
            Back to Seller Dashboard
          </Link>
        }
      />

      <nav
        aria-label="Admin navigation"
        className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card lg:flex"
      >
        <Link href="/admin" className="flex h-16 items-center gap-2 border-b border-border px-6">
          <img src="/logo.png" alt="Vendylio" className="h-8 w-auto" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Admin
          </span>
        </Link>
        <div className="flex-1 overflow-y-auto py-4">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`mx-3 mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                isActive(pathname, item.href)
                  ? 'bg-accent/10 font-semibold text-accent'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Icon i={item.icon} size={18} />
              {item.label}
            </Link>
          ))}
        </div>
        <Link
          href="/dashboard"
          className="mx-3 mb-4 flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
        >
          <Icon i="arrow-left" size={18} />
          Back to Seller Dashboard
        </Link>
      </nav>

      <nav
        aria-label="Admin navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card lg:hidden"
      >
        {mobileItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
              isActive(pathname, item.href) ? 'text-accent' : 'text-muted-foreground'
            }`}
          >
            <Icon i={item.icon} size={20} />
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
