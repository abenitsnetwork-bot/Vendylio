'use client';

import { Plus_Jakarta_Sans } from 'next/font/google';
import { SellerSidebar } from '@/components/seller/SellerSidebar';
import { ForcePasswordChange } from '@/components/auth/ForcePasswordChange';
import { UpgradeModalHost } from '@/components/seller/UpgradeModalHost';
import { MobileNavProvider } from '@/components/nav/MobileNav';

// Rounder display face for the seller dashboard only — see globals.css'
// `[data-dashboard-shell]` rule, which redefines --font-body/--font-headings
// to this variable so every existing font-body/font-headings class across
// the dashboard's pages picks it up with no per-page change.
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

// Phase 9 — persistent nav shell for the day-to-day seller pages (Dashboard,
// Orders, Products, Customers, Reviews, Delivery, Settings, Billing,
// Resources). The two product form pages (new / [id]/edit) live OUTSIDE
// this route group on purpose — they use SellerModalHeader's full-screen
// wizard feel, which the sidebar would clash with; route groups keep both
// URL sets unchanged (`(shell)` never appears in the path).
//
// Each page keeps rendering its own SellerHeader internally (unchanged from
// before this phase) — this layout only adds the persistent side/bottom
// nav around whatever the page renders, it does not centralize the header.
export default function DashboardShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileNavProvider>
      <div
        data-dashboard-shell
        className={`min-h-screen bg-background ${plusJakartaSans.variable}`}
      >
        <ForcePasswordChange />
        <UpgradeModalHost />
        <SellerSidebar />
        <div className="pb-16 lg:pb-0 lg:pl-56">{children}</div>
      </div>
    </MobileNavProvider>
  );
}
