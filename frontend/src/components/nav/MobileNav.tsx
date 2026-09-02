'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';

// ── Shared mobile navigation drawer ────────────────────────────────────────
// Both back-office shells (seller /dashboard and admin /admin) keep a compact
// 4-icon bottom bar on phones. Everything else moved into this slide-in
// drawer, opened by a "Menu" button next to the logo in the header and
// closed the moment a destination is tapped.
//
// State lives in a context so the trigger (rendered by the page header) and
// the panel (rendered by the sidebar) can talk without either knowing about
// the other. `useMobileNav()` returns null outside a provider, so a header
// used on a page with no shell (e.g. /settings) simply renders no button.

interface MobileNavState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const MobileNavContext = createContext<MobileNavState | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MobileNavContext.Provider value={{ open, setOpen }}>{children}</MobileNavContext.Provider>
  );
}

export function useMobileNav(): MobileNavState | null {
  return useContext(MobileNavContext);
}

/** "Menu" button — sits next to the logo, phone-only. */
export function MobileNavTrigger({ className }: { className?: string }) {
  const nav = useMobileNav();
  if (!nav) return null;
  return (
    <button
      type="button"
      onClick={() => nav.setOpen(true)}
      aria-label="Open menu"
      aria-expanded={nav.open}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-foreground hover:bg-secondary lg:hidden ${className ?? ''}`}
    >
      <Icon i="menu" size={20} />
      Menu
    </button>
  );
}

export interface MobileNavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: number;
  external?: boolean;
}

function itemIsActive(pathname: string, href: string): boolean {
  if (href === '/dashboard' || href === '/admin') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The slide-in panel. Rendered once per shell (by the sidebar component,
 * which already has the nav data + any badges). Closes on: item tap, backdrop
 * tap, Escape, and any route change.
 */
export function MobileNavDrawer({
  items,
  footer,
  homeHref = '/dashboard',
  title,
}: {
  items: MobileNavItem[];
  footer?: ReactNode;
  homeHref?: string;
  title?: string;
}) {
  const nav = useMobileNav();
  const pathname = usePathname();
  const open = nav?.open ?? false;

  // Close on route change (a tapped link navigates, then this fires).
  const setOpen = nav?.setOpen;
  useEffect(() => {
    setOpen?.(false);
  }, [pathname, setOpen]);

  // Escape to close + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') nav?.setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, nav]);

  if (!nav || !open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close menu"
        onClick={() => nav.setOpen(false)}
        className="absolute inset-0 h-full w-full bg-black/40"
      />
      <div className="absolute inset-y-0 left-0 flex w-72 max-w-[82vw] flex-col border-r border-border bg-card shadow-xl">
        <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-border px-4">
          <Link href={homeHref} className="flex items-center gap-2">
            <img src="/logo.png" alt="Vendylio" className="h-8 w-auto" />
            {title && (
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => nav.setOpen(false)}
            aria-label="Close menu"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Icon i="x" size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {items.map((item) => {
            const active = itemIsActive(pathname, item.href);
            const className = `mx-3 mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
              active
                ? 'bg-accent/10 font-semibold text-accent'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`;
            const body = (
              <>
                <Icon i={item.icon} size={18} />
                <span className="flex-1">{item.label}</span>
                {item.badge != null && item.badge > 0 && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-bold text-accent-foreground">
                    {item.badge}
                  </span>
                )}
              </>
            );
            return item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => nav.setOpen(false)}
                className={className}
              >
                {body}
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => nav.setOpen(false)}
                className={className}
              >
                {body}
              </Link>
            );
          })}
        </div>

        {footer && (
          <div
            className="flex-shrink-0 border-t border-border p-3"
            onClick={() => nav.setOpen(false)}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
