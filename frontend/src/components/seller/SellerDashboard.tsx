'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { ShareStoreModal } from '@/components/seller/ShareStoreModal';

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
}

export interface RecentOrder {
  id: string;
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

export function SellerDashboard({
  greetingName,
  userEmail,
  store,
  stats,
  recentOrders,
  onLogout,
}: {
  greetingName: string;
  userEmail: string;
  store: DashboardStore;
  stats: DashboardStats;
  recentOrders: RecentOrder[];
  onLogout: () => void;
}) {
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
        <div className="mb-10">
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
          >
            Welcome, {greetingName}!
          </h1>
          <p className="text-sm text-muted-foreground">Your store is live. Start selling.</p>
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
          <Card>
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Store Visits
            </p>
            <p className="font-headings text-2xl font-bold text-foreground">{stats.visits}</p>
            <p className="mt-1 text-xs text-muted-foreground">From your link</p>
          </Card>
          <Link href="/dashboard/products">
            <Card className="transition-colors hover:border-primary">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Active Products
              </p>
              <p className="font-headings text-2xl font-bold text-foreground">
                {stats.productCount}
              </p>
              <p className="mt-1 text-xs text-primary">Manage products →</p>
            </Card>
          </Link>
        </div>

        {/* Main dashboard grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-headings text-lg font-bold text-foreground">Recent Orders</h2>
              <Link href="/dashboard/orders" className="text-sm font-medium text-primary">
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
                    className="flex items-center justify-between rounded-lg border border-border p-4 hover:border-primary"
                  >
                    <div>
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
            <div className="rounded-lg border border-primary bg-primary p-6 text-primary-foreground">
              <Icon i="share-2" size={20} className="mb-4" />
              <p className="mb-2 text-sm font-semibold">Share Your Store</p>
              <p className="mb-4 text-xs" style={{ opacity: 0.8 }}>
                Copy your link and share it everywhere.
              </p>
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="w-full rounded-md bg-primary-foreground py-2 text-xs font-semibold text-primary"
              >
                Share Link
              </button>
            </div>

            <Card>
              <Icon i="package" size={20} className="mb-4 text-foreground" />
              <p className="mb-2 text-sm font-semibold text-foreground">Add Products</p>
              <p className="mb-4 text-xs text-muted-foreground">Build your product catalog.</p>
              <Link
                href="/dashboard/products/new"
                className="block w-full rounded-md bg-foreground py-2 text-center text-xs font-semibold text-background"
              >
                Add Now
              </Link>
            </Card>

            <Card className="bg-secondary">
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
          </div>
        </div>

        {/* Getting started */}
        <Card className="mt-8 bg-secondary">
          <h3 className="mb-4 font-headings text-lg font-bold text-foreground">Getting Started</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {GETTING_STARTED.map((step, i) => {
              const done = i === 0 || (i === 1 && stats.productCount > 0);
              return (
                <div key={step.title} className="flex items-start gap-3">
                  <div
                    className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      done ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
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
