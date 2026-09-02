'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { ShareStoreModal } from '@/components/seller/ShareStoreModal';
import { formatOrderNumber } from '@/lib/orderNumber';
import { usePlan } from '@/lib/usePlan';

function PlanButton() {
  const { isPro, loading } = usePlan();
  if (loading) return null;
  return (
    <Link
      href="/dashboard/billing"
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
        isPro
          ? 'bg-green-100 text-green-700 hover:bg-green-200'
          : 'bg-accent/10 text-accent hover:bg-accent/20'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isPro ? 'bg-green-600' : 'bg-accent'}`}
        aria-hidden="true"
      />
      {isPro ? 'Pro plan' : 'Free plan · Upgrade to Pro'}
      <Icon i="arrow-right" size={12} />
    </Link>
  );
}

export interface DashboardStore {
  id: string;
  slug: string;
  name: string;
}

export interface DashboardStats {
  productCount: number;
  todaySalesCents: number;
  todayOrdersCount: number;
  monthSalesCents: number;
  monthOrdersCount: number;
  visits: number;
  /** Phase 8 — orders sitting in PAID/PREPARING/READY (need merchant action). */
  pendingOrdersCount: number;
  /** Phase 4 — products/variants at or below their low-stock threshold (still > 0). */
  lowStockCount: number;
  /** Phase 4 — products/variants at zero. */
  outOfStockCount: number;
}

export interface DashboardOpenState {
  acceptingOrders: boolean;
  ordersPaused: boolean;
  pauseMessage: string | null;
  hoursConfigured: boolean;
  openNow: boolean;
  nextOpenLabel: string | null;
}

export interface RecentOrder {
  id: string;
  orderNumber: number;
  status: string;
  amount: number;
  currency: string;
  customerName: string | null;
  createdAt: string;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const GETTING_STARTED = [
  { title: 'Account Created', desc: "You're all set", done: true },
  { title: 'Add Products', desc: 'Start with 3-5 items' },
  { title: 'Share & Sell', desc: 'Send your link to friends' },
];

function storeStatusLabel(open: DashboardOpenState): {
  text: string;
  tone: 'ok' | 'warn' | 'muted';
} {
  if (open.ordersPaused) {
    return { text: 'Paused · not taking orders', tone: 'warn' };
  }
  if (open.hoursConfigured && !open.openNow) {
    return {
      text: open.nextOpenLabel ? `Closed · ${open.nextOpenLabel.toLowerCase()}` : 'Closed',
      tone: 'muted',
    };
  }
  return { text: 'Open · taking orders', tone: 'ok' };
}

export function SellerDashboard({
  greetingName,
  userEmail,
  store,
  stats,
  openState,
  recentOrders,
  topBanner,
  published = true,
  onLogout,
}: {
  greetingName: string;
  userEmail: string;
  store: DashboardStore;
  stats: DashboardStats;
  openState: DashboardOpenState;
  recentOrders: RecentOrder[];
  /** Optional slot rendered between the header and the "Welcome" heading — e.g. a "finish setup" nudge. */
  topBanner?: ReactNode;
  /** Phase 14 — the store has been launched. Drives the "get your first order" nudge. */
  published?: boolean;
  onLogout: () => void;
}) {
  const status = storeStatusLabel(openState);
  const [shareOpen, setShareOpen] = useState(false);
  const storeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/s/${store.slug}`
      : `/s/${store.slug}`;

  return (
    <div className="min-h-screen bg-background">
      <SellerHeader userName={greetingName} userEmail={userEmail} onSignOut={onLogout} />

      {/* Main content */}
      <div className="px-4 py-8 font-body lg:px-14">
        {topBanner}
        {published && recentOrders.length === 0 && (
          <div className="mb-6 flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent/5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Your store is live 🎉</p>
              <p className="text-xs text-muted-foreground">
                Share your link to get your first order — every order lands right here.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex-shrink-0 rounded-md bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90"
            >
              Share your store
            </button>
          </div>
        )}
        <div className="mb-10">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
            <h1
              className="font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
            >
              Welcome, {greetingName}!
            </h1>
            <PlanButton />
          </div>
          <Link
            href="/dashboard/settings?tab=hours"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                status.tone === 'ok'
                  ? 'bg-green-500'
                  : status.tone === 'warn'
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground'
              }`}
              aria-hidden="true"
            />
            {status.text}
          </Link>
        </div>

        {/* Stats grid */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Today&apos;s Sales
            </p>
            <p className="font-headings text-2xl font-bold text-foreground">
              {formatUsd(stats.todaySalesCents)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Orders: {stats.todayOrdersCount}</p>
          </Card>
          <Card>
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">This Month</p>
            <p className="font-headings text-2xl font-bold text-foreground">
              {formatUsd(stats.monthSalesCents)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Orders: {stats.monthOrdersCount}</p>
          </Card>
          <Link href="/dashboard/orders?status=PAID">
            <Card className="transition-colors hover:border-accent">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Pending Orders
              </p>
              <p className="font-headings text-2xl font-bold text-foreground">
                {stats.pendingOrdersCount}
              </p>
              <p
                className={`mt-1 text-xs ${
                  stats.pendingOrdersCount > 0
                    ? 'font-semibold text-accent'
                    : 'text-muted-foreground'
                }`}
              >
                {stats.pendingOrdersCount > 0 ? 'Needs attention →' : 'All caught up'}
              </p>
            </Card>
          </Link>
          {(() => {
            const restockCount = stats.lowStockCount + stats.outOfStockCount;
            return (
              <Link href={restockCount > 0 ? '/dashboard/inventory' : '/dashboard/products'}>
                <Card className="transition-colors hover:border-accent">
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    Active Products
                  </p>
                  <p className="font-headings text-2xl font-bold text-foreground">
                    {stats.productCount}
                  </p>
                  {restockCount > 0 ? (
                    <p className="mt-1 text-xs font-semibold text-amber-600">
                      ⚠ {restockCount} to restock →
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Manage products →</p>
                  )}
                </Card>
              </Link>
            );
          })()}
        </div>

        {/* Main dashboard grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-headings text-lg font-bold text-foreground">Recent Orders</h2>
              <Link
                href="/dashboard/orders"
                className="text-sm font-semibold text-accent hover:underline"
              >
                View all
              </Link>
            </div>
            {recentOrders.length === 0 ? (
              <div className="py-12 text-center">
                <Icon
                  i="inbox"
                  size={32}
                  className="mx-auto mb-4 text-muted-foreground opacity-50"
                />
                <p className="text-sm text-muted-foreground">
                  No orders yet. Share your store link to start selling!
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:border-accent"
                  >
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        {formatOrderNumber(order.orderNumber)}
                      </p>
                      <p className="text-sm font-semibold text-foreground">
                        {order.customerName ?? 'Guest'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground">{formatUsd(order.amount)}</p>
                      <p className="text-xs text-muted-foreground">{order.status}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <div className="flex flex-col gap-4">
            <div className="rounded-lg bg-accent p-6 text-accent-foreground">
              <Icon i="share-2" size={20} className="mb-4" />
              <p className="mb-2 text-sm font-semibold">Share Your Store</p>
              <p className="mb-4 text-xs" style={{ opacity: 0.9 }}>
                Copy your link and share it everywhere.
              </p>
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="w-full rounded-md bg-white py-2 text-xs font-semibold text-accent hover:opacity-90"
              >
                Share Link
              </button>
            </div>

            <Card>
              <Icon i="package" size={20} className="mb-4 text-accent" />
              <p className="mb-2 text-sm font-semibold text-foreground">Add Products</p>
              <p className="mb-4 text-xs text-muted-foreground">Build your product catalog.</p>
              <Link
                href="/dashboard/products/new"
                className="block w-full rounded-md bg-accent py-2 text-center text-xs font-semibold text-accent-foreground hover:opacity-90"
              >
                Add Now
              </Link>
            </Card>

            <Card>
              <Icon i="store" size={20} className="mb-4 text-foreground" />
              <p className="mb-2 text-sm font-semibold text-foreground">Customize Store</p>
              <p className="mb-4 text-xs text-muted-foreground">Logo, template, and store link.</p>
              <Link
                href="/dashboard/settings"
                className="block w-full rounded-md border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
              >
                Customize
              </Link>
            </Card>

            <Card>
              <Icon i="truck" size={20} className="mb-4 text-foreground" />
              <p className="mb-2 text-sm font-semibold text-foreground">Delivery</p>
              <p className="mb-4 text-xs text-muted-foreground">
                You deliver — no setup required. Set a fee, track deliveries.
              </p>
              <Link
                href="/dashboard/delivery"
                className="block w-full rounded-md border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
              >
                Manage Delivery
              </Link>
            </Card>

            <Card>
              <Icon i="users" size={20} className="mb-4 text-foreground" />
              <p className="mb-2 text-sm font-semibold text-foreground">Customers</p>
              <p className="mb-4 text-xs text-muted-foreground">
                See who's bought from you and how much they've spent.
              </p>
              <Link
                href="/dashboard/customers"
                className="block w-full rounded-md border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
              >
                View Customers
              </Link>
            </Card>

            <Card>
              <Icon i="star" size={20} className="mb-4 text-foreground" />
              <p className="mb-2 text-sm font-semibold text-foreground">Reviews</p>
              <p className="mb-4 text-xs text-muted-foreground">
                Moderate what shows up on your public storefront.
              </p>
              <Link
                href="/dashboard/reviews"
                className="block w-full rounded-md border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
              >
                View Reviews
              </Link>
            </Card>

            <Card>
              <Icon i="message-circle" size={20} className="mb-4 text-foreground" />
              <p className="mb-2 text-sm font-semibold text-foreground">Share Your Story</p>
              <p className="mb-4 text-xs text-muted-foreground">
                Love Vendylio? Send us a few words — we might feature you on the homepage.
              </p>
              <Link
                href="/dashboard/testimonial"
                className="block w-full rounded-md border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
              >
                Write a Testimonial
              </Link>
            </Card>
          </div>
        </div>

        {/* Getting started */}
        <Card className="mt-8">
          <h3 className="mb-4 font-headings text-lg font-bold text-foreground">Getting Started</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {GETTING_STARTED.map((step, i) => {
              const done = i === 0 || (i === 1 && stats.productCount > 0);
              return (
                <div key={step.title} className="flex items-start gap-3">
                  <div
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      done ? 'bg-accent text-accent-foreground' : 'bg-muted text-foreground'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{step.title}</p>
                    <p className="text-xs text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {shareOpen && (
        <Modal onClose={() => setShareOpen(false)}>
          <ShareStoreModal storeUrl={storeUrl} onClose={() => setShareOpen(false)} />
        </Modal>
      )}
    </div>
  );
}
