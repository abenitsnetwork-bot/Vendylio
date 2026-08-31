'use client';

import { SellerSidebar } from '@/components/seller/SellerSidebar';
import { ForcePasswordChange } from '@/components/auth/ForcePasswordChange';

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
    <div className="min-h-screen bg-background">
      <ForcePasswordChange />
      <SellerSidebar />
      <div className="pb-16 lg:pb-0 lg:pl-56">{children}</div>
    </div>
  );
}
