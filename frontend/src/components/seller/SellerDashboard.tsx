'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { StatCard, type StatAccent } from '@/components/ui/StatCard';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { Modal } from '@/components/ui/Modal';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { ShareStoreModal } from '@/components/seller/ShareStoreModal';
import { formatOrderNumber } from '@/lib/orderNumber';
import { usePlan } from '@/lib/usePlan';
import type { OnboardingProgress } from '@/lib/onboardingProgress';
import {
  CHART_ACCENT,
  CHART_AXIS,
  CHART_GRID,
  TOOLTIP_STYLE,
} from '@/components/admin/dashboard/colors';
import type {
  DashboardStats,
  DashboardStore,
  DashboardOpenState,
  RecentOrder,
  DailySales,
} from '@/lib/server/dashboard/overview';

function PlanButton() {
  const { isPro, loading } = usePlan();
  if (loading) return null;
  return (
    <Link
      href="/dashboard/billing"
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
        isPro
          ? 'bg-green-100 text-green-700 hover:bg-green-200'
          : 'bg-white/15 text-panel-foreground hover:bg-white/25'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isPro ? 'bg-green-600' : 'bg-panel-foreground'}`}
        aria-hidden="true"
      />
      {isPro ? 'Pro plan' : 'Free plan · Upgrade to Pro'}
      <Icon i="arrow-right" size={12} />
    </Link>
  );
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

function SetupBanner({
  href,
  title,
  subtitle,
  cta,
}: {
  href: string;
  title: string;
  subtitle: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-accent/40 bg-accent/5 p-5 hover:opacity-90"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span className="flex flex-shrink-0 items-center gap-1 text-sm font-semibold text-accent">
        {cta} <Icon i="arrow-right" size={14} />
      </span>
    </Link>
  );
}

function ActionCard({
  icon,
  accent,
  title,
  desc,
  href,
  cta,
}: {
  icon: IconName;
  accent: StatAccent;
  title: string;
  desc: string;
  href: string;
  cta: string;
}) {
  const colorVar = `var(--color-stat-${accent})`;
  return (
    <Card>
      <span
        className="mb-4 flex h-9 w-9 items-center justify-center rounded-full"
        style={{
          backgroundColor: `color-mix(in srgb, ${colorVar} 16%, transparent)`,
          color: colorVar,
        }}
      >
        <Icon i={icon} size={18} />
      </span>
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <p className="mb-4 text-xs text-muted-foreground">{desc}</p>
      <Link
        href={href}
        className="block w-full rounded-md border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
      >
        {cta}
      </Link>
    </Card>
  );
}

export function SellerDashboard({
  greetingName,
  userEmail,
  store,
  stats,
  openState,
  recentOrders,
  weeklySales,
  fulfillmentRatePct,
  progress,
  published = true,
}: {
  greetingName: string;
  userEmail: string;
  store: DashboardStore;
  stats: DashboardStats;
  openState: DashboardOpenState;
  recentOrders: RecentOrder[];
  weeklySales: DailySales[];
  fulfillmentRatePct: number;
  progress: OnboardingProgress;
  /** Phase 14 — the store has been launched. Drives the "get your first order" nudge. */
  published?: boolean;
}) {
  const { logout } = useAuth();
  const router = useRouter();
  const status = storeStatusLabel(openState);
  const [shareOpen, setShareOpen] = useState(false);
  const storeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/s/${store.slug}`
      : `/s/${store.slug}`;

  const restockCount = stats.lowStockCount + stats.outOfStockCount;
  const stockHealthPct =
    stats.productCount > 0
      ? Math.round(((stats.productCount - restockCount) / stats.productCount) * 100)
      : null;

  let topBanner: React.ReactNode = null;
  let bannerSubtext = status.text;
  if (!progress.mandatoryComplete) {
    const stepsAway = 1 + progress.incompleteOptionalCount;
    topBanner = (
      <SetupBanner
        href="/onboarding"
        title="Finish setting up your store"
        subtitle={`You're ${stepsAway} step${stepsAway === 1 ? '' : 's'} away from going live.`}
        cta="Continue setup"
      />
    );
  } else if (progress.readyToLaunch) {
    topBanner = (
      <SetupBanner
        href="/onboarding/launch"
        title="Your store is ready to launch"
        subtitle="Everything required is done — publish it so customers can start ordering."
        cta="Review & launch"
      />
    );
  } else if (stats.pendingOrdersCount > 0) {
    bannerSubtext = `${stats.pendingOrdersCount} order${stats.pendingOrdersCount === 1 ? '' : 's'} waiting on you`;
  }

  return (
    <div className="min-h-screen bg-background">
      <SellerHeader
        userName={greetingName}
        userEmail={userEmail}
        onSignOut={async () => {
          await logout();
          router.push('/');
        }}
      />

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
              className="flex-shrink-0 rounded-md border border-border bg-secondary px-4 py-2 text-xs font-semibold text-foreground hover:opacity-90"
            >
              Share your store
            </button>
          </div>
        )}

        {/* Greeting banner */}
        <div className="relative mb-8 overflow-hidden rounded-2xl bg-panel p-6 text-panel-foreground sm:p-8">
          <div
            aria-hidden="true"
            className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-accent/25"
          />
          <div
            aria-hidden="true"
            className="absolute -right-2 bottom-0 h-24 w-24 rounded-full bg-panel-foreground/10"
          />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1
                className="mb-2 font-headings font-bold"
                style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
              >
                Welcome, {greetingName}!
              </h1>
              <Link
                href="/dashboard/settings?tab=hours"
                className="inline-flex items-center gap-2 text-sm text-panel-foreground/80 hover:text-panel-foreground"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    status.tone === 'ok'
                      ? 'bg-green-400'
                      : status.tone === 'warn'
                        ? 'bg-amber-400'
                        : 'bg-panel-foreground/50'
                  }`}
                  aria-hidden="true"
                />
                {bannerSubtext}
              </Link>
            </div>
            <PlanButton />
          </div>
        </div>

        {/* Stats grid */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            icon="dollar-sign"
            accent="indigo"
            label="Today's Sales"
            value={formatUsd(stats.todaySalesCents)}
            sub={`Orders: ${stats.todayOrdersCount}`}
          />
          <StatCard
            icon="trending-up"
            accent="violet"
            label="This Month"
            value={formatUsd(stats.monthSalesCents)}
            sub={`Orders: ${stats.monthOrdersCount}`}
          />
          <StatCard
            icon="bar-chart-3"
            accent="emerald"
            label="All-Time Sales"
            value={formatUsd(stats.allTimeSalesCents)}
            sub={`Orders: ${stats.allTimeOrdersCount}`}
          />
          <StatCard
            icon="clock"
            accent="amber"
            label="Pending Orders"
            value={stats.pendingOrdersCount}
            sub={stats.pendingOrdersCount > 0 ? 'Needs attention →' : 'All caught up'}
            subTone={stats.pendingOrdersCount > 0 ? 'accent' : 'muted'}
            href="/dashboard/orders?status=PAID"
          />
          <StatCard
            icon="package"
            accent="sky"
            label="Active Products"
            value={stats.productCount}
            sub={restockCount > 0 ? `⚠ ${restockCount} to restock →` : 'Manage products →'}
            subTone={restockCount > 0 ? 'warn' : 'muted'}
            href={restockCount > 0 ? '/dashboard/inventory' : '/dashboard/products'}
          />
          <StatCard
            icon="eye"
            accent="rose"
            label="Visits (30d)"
            value={stats.visits}
            sub="Storefront views"
          />
        </div>

        {/* Trend + health */}
        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel text-panel-foreground">
                <Icon i="trending-up" size={13} />
              </span>
              <h2 className="font-headings text-lg font-bold text-foreground">
                Sales — last 7 days
              </h2>
            </div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklySales} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="weeklySalesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={{ stroke: CHART_GRID }}
                  />
                  <YAxis
                    width={48}
                    tick={{ fontSize: 11, fill: CHART_AXIS }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                    }
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v) => [formatUsd(Number(v)), 'Sales']}
                  />
                  <Area
                    type="monotone"
                    dataKey="salesCents"
                    name="Sales"
                    stroke={CHART_ACCENT}
                    strokeWidth={2}
                    fill="url(#weeklySalesFill)"
                    dot={false}
                    activeDot={{ r: 4 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="flex flex-col justify-center gap-6">
            <div className="flex items-center gap-4">
              <RadialGauge value={fulfillmentRatePct} color="var(--color-stat-emerald)" />
              <div>
                <p className="font-headings text-sm font-bold text-foreground">Fulfillment rate</p>
                <p className="text-xs text-muted-foreground">Delivered vs. paid, this month</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {stockHealthPct === null ? (
                <>
                  <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-full bg-secondary">
                    <Icon i="package" size={20} className="text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-headings text-sm font-bold text-foreground">Stock health</p>
                    <p className="text-xs text-muted-foreground">Add products to track this</p>
                  </div>
                </>
              ) : (
                <>
                  <RadialGauge value={stockHealthPct} color="var(--color-stat-sky)" />
                  <div>
                    <p className="font-headings text-sm font-bold text-foreground">Stock health</p>
                    <p className="text-xs text-muted-foreground">Products above their threshold</p>
                  </div>
                </>
              )}
            </div>
          </Card>
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
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-stat-indigo/15 text-stat-indigo">
                        <Icon i="shopping-bag" size={16} />
                      </span>
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
            <div className="rounded-xl bg-panel p-6 text-panel-foreground">
              <Icon i="share-2" size={20} className="mb-4" />
              <p className="mb-2 text-sm font-semibold">Share Your Store</p>
              <p className="mb-4 text-xs" style={{ opacity: 0.9 }}>
                Copy your link and share it everywhere.
              </p>
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="w-full rounded-md bg-panel-foreground py-2 text-xs font-semibold text-panel hover:opacity-90"
              >
                Share Link
              </button>
            </div>

            <ActionCard
              icon="package"
              accent="indigo"
              title="Add Products"
              desc="Build your product catalog."
              href="/dashboard/products/new"
              cta="Add Now"
            />
            <ActionCard
              icon="store"
              accent="violet"
              title="Customize Store"
              desc="Logo, template, and store link."
              href="/dashboard/settings"
              cta="Customize"
            />
            <ActionCard
              icon="truck"
              accent="sky"
              title="Delivery"
              desc="You deliver — no setup required. Set a fee, track deliveries."
              href="/dashboard/delivery"
              cta="Manage Delivery"
            />
            <ActionCard
              icon="users"
              accent="emerald"
              title="Customers"
              desc="See who's bought from you and how much they've spent."
              href="/dashboard/customers"
              cta="View Customers"
            />
            <ActionCard
              icon="star"
              accent="amber"
              title="Reviews"
              desc="Moderate what shows up on your public storefront."
              href="/dashboard/reviews"
              cta="View Reviews"
            />
            <ActionCard
              icon="message-circle"
              accent="rose"
              title="Share Your Story"
              desc="Love Vendylio? Send us a few words — we might feature you on the homepage."
              href="/dashboard/testimonial"
              cta="Write a Testimonial"
            />
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
                      done ? 'bg-stat-emerald text-white' : 'bg-muted text-foreground'
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
