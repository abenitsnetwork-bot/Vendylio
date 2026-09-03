'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { useUser } from '@/contexts/AuthContext';
import { MobileNavDrawer, type MobileNavItem } from '@/components/nav/MobileNav';
import { ThemeToggle } from '@/components/ThemeToggle';

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
  { href: '/dashboard/analytics', label: 'Analytics', icon: 'bar-chart-3' },
  { href: '/dashboard/reviews', label: 'Reviews', icon: 'star' },
  { href: '/dashboard/discounts', label: 'Promo codes', icon: 'bookmark' },
  { href: '/dashboard/delivery', label: 'Delivery', icon: 'truck' },
  { href: '/dashboard/billing', label: 'Billing & Payouts', icon: 'credit-card' },
  { href: '/dashboard/team', label: 'Team', icon: 'user' },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
  { href: '/dashboard/resources', label: 'Help & Resources', icon: 'life-buoy' },
];

// Mobile keeps only the four highest-traffic destinations in the fixed
// bottom bar — more than that and the labels collide on a phone. Everything
// else is one tap away via the "Menu" drawer (opened from the header).
const MOBILE_NAV_ITEMS: NavItem[] = [
  NAV_ITEMS.find((i) => i.href === '/dashboard')!,
  NAV_ITEMS.find((i) => i.href === '/dashboard/orders')!,
  NAV_ITEMS.find((i) => i.href === '/dashboard/products')!,
  NAV_ITEMS.find((i) => i.href === '/dashboard/settings')!,
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

  const drawerItems: MobileNavItem[] = NAV_ITEMS.map((item) => {
    const badge = badgeFor(item.href);
    return badge > 0 ? { ...item, badge } : item;
  });

  return (
    <>
      {/* Full nav — the "Menu" drawer (phone only, opened from the header) */}
      <MobileNavDrawer
        items={drawerItems}
        homeHref="/dashboard"
        footer={
          <div className="flex flex-col gap-2">
            {storeSlug && (
              <a
                href={`/s/${storeSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
              >
                <Icon i="store" size={18} />
                View Store ↗
              </a>
            )}
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
          </div>
        }
      />

      {/* Desktop sidebar */}
      <nav
        aria-label="Seller navigation"
        className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-card lg:flex"
      >
        <Link href="/dashboard" className="flex h-16 items-center border-b border-border px-6">
          <img src="/logo.png" alt="Vendylio" className="h-9 w-auto" />
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
                    ? 'bg-accent/10 font-semibold text-accent'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                <Icon i={item.icon} size={18} />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold text-accent-foreground">
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
            className="mx-3 mb-3 flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
          >
            <Icon i="store" size={18} />
            View Store ↗
          </a>
        )}
        <div className="mx-3 mb-4 flex items-center justify-between rounded-lg border border-border px-3 py-2">
          <span className="text-sm font-medium text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
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
                isActive(pathname, item.href) ? 'text-accent' : 'text-muted-foreground'
              }`}
            >
              <Icon i={item.icon} size={20} />
              {badge > 0 && (
                <span className="absolute right-1/2 top-1 ml-3 translate-x-4 rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
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
