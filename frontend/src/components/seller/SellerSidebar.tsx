'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { useUser } from '@/contexts/AuthContext';

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home' },
  { href: '/dashboard/orders', label: 'Orders', icon: 'shopping-bag' },
  { href: '/dashboard/products', label: 'Products', icon: 'package' },
  { href: '/dashboard/inventory', label: 'Inventory', icon: 'clipboard' },
  { href: '/dashboard/customers', label: 'Customers', icon: 'users' },
  { href: '/dashboard/reviews', label: 'Reviews', icon: 'star' },
  { href: '/dashboard/delivery', label: 'Delivery', icon: 'truck' },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
];

// Mobile keeps only the highest-traffic destinations in the fixed bottom
// bar — the full label list doesn't fit a phone width. Everything is still
// one tap away from the desktop sidebar or the Dashboard home's own cards.
const MOBILE_NAV_ITEMS: NavItem[] = [
  NAV_ITEMS[0]!,
  NAV_ITEMS[1]!,
  NAV_ITEMS[2]!,
  NAV_ITEMS[3]!,
  NAV_ITEMS[7]!,
];

function isActive(pathname: string, href: string): boolean {
  return href === '/dashboard' ? pathname === href : pathname.startsWith(href);
}

/**
 * Persistent seller navigation — Phase 9. Desktop: fixed left column.
 * Mobile: fixed bottom tab bar (no drawer/hamburger state needed — simpler
 * and avoids threading toggle state up into a shared layout that individual
 * pages don't otherwise know about, since each page still renders its own
 * SellerHeader independently).
 */
export function SellerSidebar() {
  const user = useUser();
  const pathname = usePathname();
  const [storeSlug, setStoreSlug] = useState<string | null>(null);
  const [pendingOrders, setPendingOrders] = useState(0);

  useEffect(() => {
    if (!user) return;
    api<{ store: { slug: string }; stats: { pendingOrdersCount: number } }>('/api/stores/me')
      .then((res) => {
        setStoreSlug(res.store.slug);
        setPendingOrders(res.stats.pendingOrdersCount ?? 0);
      })
      .catch(() => {
        // No store yet (mid-onboarding) — the "View Store" link just stays hidden.
      });
  }, [user]);

  function badgeFor(href: string): number {
    return href === '/dashboard/orders' ? pendingOrders : 0;
  }

  if (!user) return null;

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        aria-label="Seller navigation"
        className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card lg:flex"
      >
        <Link href="/dashboard" className="flex h-16 items-center border-b border-border px-6">
          <img src="/vendylio-logo.svg" alt="Vendylio" className="h-7 w-auto" />
        </Link>
        <div className="flex-1 overflow-y-auto py-4">
          {NAV_ITEMS.map((item) => {
            const badge = badgeFor(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`mx-3 mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(pathname, item.href)
                    ? 'bg-secondary text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <Icon i={item.icon} size={18} />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold text-primary-foreground">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        {storeSlug && (
          <a
            href={`/s/${storeSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-3 mb-4 flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
          >
            <Icon i="store" size={18} />
            View Store ↗
          </a>
        )}
      </nav>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Seller navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card lg:hidden"
      >
        {MOBILE_NAV_ITEMS.map((item) => {
          const badge = badgeFor(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
                isActive(pathname, item.href) ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <Icon i={item.icon} size={20} />
              {badge > 0 && (
                <span className="absolute right-1/2 top-1 ml-3 translate-x-4 rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {badge}
                </span>
              )}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
