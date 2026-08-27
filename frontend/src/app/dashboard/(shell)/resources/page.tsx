'use client';

import { sellerFirstName } from '@/lib/utils';
import Link from 'next/link';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';

// Banani's source also showed Marketing/Operations/Money categories, a
// templates-download grid, seller "success stories", and an email signup —
// all with no real content or backend behind them (no files to download, no
// newsletter capture, fabricated testimonials). Shipping those as clickable
// UI would be dishonest busywork; this page only lists the 3 guides that
// actually exist. Extend this list as new guides get built.
const GUIDES = [
  {
    title: 'Your First 5 Products',
    time: '12 min',
    href: '/dashboard/resources/first-products',
  },
  { title: 'Setting Up Delivery', time: '8 min', href: '/dashboard/resources/delivery' },
  { title: 'Payment Setup', time: '5 min', href: '/dashboard/resources/payment-setup' },
];

export default function ResourcesCenterPage() {
  const user = useUser();
  const { logout } = useAuth();
  if (!user) return null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerHeader
        userName={sellerFirstName(user)}
        userEmail={user.email}
        onSignOut={async () => {
          await logout();
        }}
      />
      <div className="px-4 py-16 lg:px-14">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16">
            <h1
              className="mb-4 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(32px, 6vw, 48px)', letterSpacing: '-1.5px' }}
            >
              Resources for Sellers
            </h1>
            <p className="max-w-3xl text-lg text-muted-foreground">
              Guides to help you launch and grow your Vendylio store.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-8">
            <div className="mb-6 flex items-start gap-4 border-b border-border pb-6">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Icon i="rocket" size={24} className="text-primary" />
              </div>
              <div>
                <h3 className="font-headings text-lg font-bold text-foreground">Getting Started</h3>
                <p className="text-sm text-muted-foreground">Guides to launch your store</p>
              </div>
            </div>
            <div className="space-y-3">
              {GUIDES.map((guide) => (
                <Link
                  key={guide.title}
                  href={guide.href}
                  className="flex w-full items-center justify-between rounded border border-border p-3 transition-colors hover:bg-secondary"
                >
                  <span className="text-sm font-medium text-foreground">{guide.title}</span>
                  <span className="text-xs text-muted-foreground">{guide.time}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
