'use client';

import { sellerFirstName } from '@/lib/utils';
import Link from 'next/link';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { Icon, type IconName } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { Card } from '@/components/ui/Card';
import { RESOURCE_CATEGORIES, guidesByCategory, guideHref } from '@/lib/resourceGuides';

// The Banani mock for this screen also had a "Download Templates" grid,
// fabricated seller "success stories" ($50k revenue, +$500/week…) and a
// newsletter signup — none backed by anything real (no files, no revenue
// data, no marketing-email list). Vendylio's rule is no fake social proof
// and no dead controls, so this page ships only what exists: real guides,
// grouped, plus shortcuts to the tools those guides talk about.

// Honest replacements for the mock's "download a template" cards — each one
// opens a real Vendylio tool.
const QUICK_ACTIONS: { label: string; href: string; icon: IconName }[] = [
  { label: 'Add a product', href: '/dashboard/products/new', icon: 'plus' },
  { label: 'Create a promo code', href: '/dashboard/discounts', icon: 'bookmark' },
  { label: 'Review inventory', href: '/dashboard/inventory', icon: 'package' },
  { label: 'Check payouts', href: '/dashboard/billing', icon: 'dollar-sign' },
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
      <div className="px-4 py-12 lg:px-14">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12">
            <h1
              className="mb-3 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(28px, 5vw, 44px)', letterSpacing: '-1.2px' }}
            >
              Help &amp; Resources
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground">
              Short, practical guides for running your Vendylio store — written around the features
              you already have.
            </p>
          </div>

          {/* Quick actions — the honest version of "download a template" */}
          <div className="mb-14 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
                  <Icon i={action.icon} size={18} className="text-primary" />
                </span>
                <span className="text-sm font-semibold text-foreground">{action.label}</span>
              </Link>
            ))}
          </div>

          {/* Guides, grouped by category */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {RESOURCE_CATEGORIES.map((cat) => {
              const guides = guidesByCategory(cat.key);
              if (guides.length === 0) return null;
              return (
                <Card key={cat.key} className="p-6">
                  <div className="mb-5 flex items-start gap-4 border-b border-border pb-5">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-secondary">
                      <Icon i={cat.icon} size={22} className="text-primary" />
                    </div>
                    <div>
                      <h2 className="font-headings text-lg font-bold text-foreground">{cat.key}</h2>
                      <p className="text-sm text-muted-foreground">{cat.tagline}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {guides.map((guide) => (
                      <Link
                        key={guide.slug}
                        href={guideHref(guide.slug)}
                        className="block rounded-lg border border-border p-3.5 transition-colors hover:bg-secondary"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-foreground">
                            {guide.title}
                          </span>
                          <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
                            <Icon i="clock" size={12} />
                            {guide.time}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{guide.blurb}</p>
                      </Link>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Honest "success story" pointer — real testimonials only, seller-submitted */}
          <div className="mt-10 flex flex-col gap-3 rounded-xl border border-border bg-secondary p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Built something you&apos;re proud of?
              </p>
              <p className="text-xs text-muted-foreground">
                Send us your story — if we feature it, it goes on the Vendylio homepage with your
                name and store.
              </p>
            </div>
            <Link
              href="/dashboard/testimonial"
              className="flex-shrink-0 rounded-md border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-background"
            >
              Share your story
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
