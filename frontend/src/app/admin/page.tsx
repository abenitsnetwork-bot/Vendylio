'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '@/lib/api';
import { formatUsdPerUnit } from '@/lib/productUnits';
import { StatusBadge, formatUsd } from '@/components/seller/OrdersTable';
import { formatOrderNumber } from '@/lib/orderNumber';
import { StoreOverviewSection } from '@/components/admin/StoreOverviewSection';
import { SectionBand } from '@/components/admin/dashboard/SectionBand';
import { KpiTile } from '@/components/admin/dashboard/KpiTile';
import { BreakdownDonut } from '@/components/admin/dashboard/BreakdownDonut';
import { RevenueDonut } from '@/components/admin/dashboard/RevenueDonut';
import { TrendComboChart, type TrendPoint } from '@/components/admin/dashboard/TrendComboChart';
import {
  SystemQueueStrip,
  type QueueSnapshot,
} from '@/components/admin/dashboard/SystemQueueStrip';
import {
  CHART_ACCENT,
  CHART_AXIS,
  CHART_GRID,
  TOOLTIP_STYLE,
} from '@/components/admin/dashboard/colors';

interface KpiSeries {
  value: number;
  deltaPct?: number | null;
  spark?: number[];
  addedInPeriod?: number;
}
interface Pulse {
  periodDays: number;
  kpis: {
    gmv: KpiSeries;
    orders: KpiSeries;
    newCustomers: KpiSeries;
    platformRevenue: KpiSeries;
    merchants: KpiSeries;
    activeStores: KpiSeries;
    activeDeliveries: KpiSeries;
    failedPayments: KpiSeries;
  };
  revenueMix: { method: string; gmvCents: number; orderCount: number }[];
  daily: { date: string; gmvCents: number; orderCount: number; newCustomers: number }[];
  queue: QueueSnapshot;
}

interface Analytics {
  revenueByMonth: { month: string; gmvCents: number; orderCount: number }[];
  customerGrowthByMonth: { month: string; newCustomers: number }[];
  salesByCategory: { category: string; revenueCents: number }[];
  topProducts: { productId: string; name: string; revenueCents: number; unitsSold: number }[];
}

interface RecentOrder {
  id: string;
  orderNumber: number;
  amount: number;
  status: string;
  customerEmail: string | null;
  provider: string;
  createdAt: string;
}

function usd(cents: number): string {
  return formatUsdPerUnit(cents, 'UNIT');
}
/** "$407.3k" — compact money for the big KPI numbers. */
function usdCompact(cents: number): string {
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(dollars)}`;
  }
  return usd(cents);
}
function count(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}
/** Short "Sep 1" label from a YYYY-MM-DD key. */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function AdminDashboardPage() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<'30d' | '6m'>('30d');

  useEffect(() => {
    api<Pulse>('/api/admin/pulse')
      .then(setPulse)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load metrics.'));
    api<Analytics>('/api/admin/analytics')
      .then(setAnalytics)
      .catch((err) =>
        setError(
          (prev) => prev ?? (err instanceof ApiError ? err.message : 'Could not load analytics.'),
        ),
      );
    api<{ items: RecentOrder[] }>('/api/admin/orders?limit=5')
      .then((res) => setRecentOrders(res.items))
      .catch(() => setRecentOrders([]));
  }, []);

  const k = pulse?.kpis;
  const period = pulse ? `${pulse.periodDays}d` : '30d';

  const trendData: TrendPoint[] =
    trendRange === '30d' && pulse
      ? pulse.daily.map((d) => ({
          label: dayLabel(d.date),
          gmvCents: d.gmvCents,
          orderCount: d.orderCount,
        }))
      : (analytics?.revenueByMonth ?? []).map((m) => ({
          label: m.month,
          gmvCents: m.gmvCents,
          orderCount: m.orderCount,
        }));

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-6 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Platform Overview
      </h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!pulse && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* ── Sales overview (Octoboard-style: stacked KPIs · donut · trend) ─── */}
      {k && (
        <SectionBand
          title={`Sales overview — last ${pulse!.periodDays} days`}
          icon="bar-chart-3"
          meta={
            <div className="flex overflow-hidden rounded-md border border-panel-foreground/25">
              {(['30d', '6m'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setTrendRange(r)}
                  className={`px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${
                    trendRange === r
                      ? 'bg-panel-foreground text-panel'
                      : 'text-panel-foreground/70 hover:text-panel-foreground'
                  }`}
                >
                  {r === '30d' ? '30 days' : '6 months'}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {/* Left — the money story, stacked */}
            <div className="space-y-3 lg:col-span-1">
              <KpiTile
                label="GMV"
                icon="trending-up"
                value={usdCompact(k.gmv.value)}
                deltaPct={k.gmv.deltaPct ?? null}
                deltaSuffix={period}
                spark={k.gmv.spark}
                accent
                compact
                valueTone="positive"
              />
              <KpiTile
                label="Platform revenue"
                icon="dollar-sign"
                value={usdCompact(k.platformRevenue.value)}
                deltaPct={k.platformRevenue.deltaPct ?? null}
                deltaSuffix={period}
                spark={k.platformRevenue.spark}
                accent
                compact
                valueTone="positive"
              />
              <KpiTile
                label="Paid orders"
                icon="shopping-bag"
                value={count(k.orders.value)}
                deltaPct={k.orders.deltaPct ?? null}
                deltaSuffix={period}
                spark={k.orders.spark}
                compact
              />
              <KpiTile
                label="New customers"
                icon="users"
                value={count(k.newCustomers.value)}
                deltaPct={k.newCustomers.deltaPct ?? null}
                deltaSuffix={period}
                spark={k.newCustomers.spark}
                sparkTone="accent"
                compact
              />
            </div>

            {/* Centre — the "Sales revenue" ring (GMV split by payment method) */}
            <div className="rounded-lg border border-border bg-card p-4 lg:col-span-1">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Sales revenue · by method
              </p>
              <RevenueDonut
                slices={(pulse?.revenueMix ?? []).map((m) => ({
                  label: m.method,
                  valueCents: m.gmvCents,
                  note: `${m.orderCount} ${m.orderCount === 1 ? 'order' : 'orders'}`,
                }))}
                centerValue={usdCompact(k.gmv.value)}
                centerLabel={`total · ${period}`}
                formatMoney={usd}
              />
            </div>

            {/* Right — the trend combo */}
            <div className="rounded-lg border border-border bg-card p-4 lg:col-span-1 xl:col-span-2">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {trendRange === '30d' ? 'Daily' : 'Monthly'} GMV &amp; orders
              </p>
              {!pulse && !analytics ? (
                <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
              ) : trendData.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No revenue data yet.
                </p>
              ) : (
                <TrendComboChart data={trendData} formatMoney={usd} height={240} />
              )}
            </div>
          </div>
        </SectionBand>
      )}

      {/* ── Platform health (ops KPIs + live queue) ───────────────────────── */}
      {pulse && k && (
        <SectionBand title="Platform health" icon="life-buoy" meta="live snapshot">
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              label="Merchants"
              icon="briefcase"
              value={count(k.merchants.value)}
              addedNote={
                (k.merchants.addedInPeriod ?? 0) > 0
                  ? `+${k.merchants.addedInPeriod} new / ${period}`
                  : undefined
              }
            />
            <KpiTile
              label="Active stores"
              icon="store"
              value={count(k.activeStores.value)}
              addedNote={
                (k.activeStores.addedInPeriod ?? 0) > 0
                  ? `+${k.activeStores.addedInPeriod} new / ${period}`
                  : undefined
              }
            />
            <KpiTile
              label="Active deliveries"
              icon="truck"
              value={count(k.activeDeliveries.value)}
            />
            <KpiTile
              label="Failed payments"
              icon="alert-circle"
              value={count(k.failedPayments.value)}
              deltaPct={k.failedPayments.deltaPct ?? null}
              deltaSuffix={period}
              invertDelta
            />
          </div>
          <SystemQueueStrip queue={pulse.queue} />
        </SectionBand>
      )}

      {/* ── Sales mix ─────────────────────────────────────────────────────── */}
      <SectionBand title="Sales mix" icon="pie-chart" meta="paid orders">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              By category
            </p>
            <BreakdownDonut
              rows={(analytics?.salesByCategory ?? []).map((c) => ({
                label: c.category,
                valueCents: c.revenueCents,
              }))}
              formatMoney={usd}
            />
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top-selling products
            </p>
            {!analytics || analytics.topProducts.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">No paid orders yet.</p>
            ) : (
              <div className="space-y-3">
                {analytics.topProducts.map((p, i) => (
                  <div key={p.productId} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.unitsSold} sold</p>
                      </div>
                    </div>
                    <p className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
                      {usd(p.revenueCents)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SectionBand>

      {/* ── Customers ─────────────────────────────────────────────────────── */}
      <SectionBand title="Customer growth" icon="users" meta="last 6 months">
        {!analytics ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.customerGrowthByMonth}
                margin={{ top: 8, right: 8, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: CHART_AXIS }} />
                <YAxis tick={{ fontSize: 11, fill: CHART_AXIS }} allowDecimals={false} width={30} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar
                  dataKey="newCustomers"
                  name="New customers"
                  fill={CHART_ACCENT}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionBand>

      {/* ── Stores (existing component) ───────────────────────────────────── */}
      <SectionBand title="Stores" icon="store">
        <StoreOverviewSection />
      </SectionBand>

      {/* ── Recent transactions ──────────────────────────────────────────── */}
      <SectionBand title="Recent transactions" icon="shopping-bag">
        {!recentOrders && <p className="text-sm text-muted-foreground">Loading…</p>}
        {recentOrders && recentOrders.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No orders yet.</p>
        )}
        {recentOrders && recentOrders.length > 0 && (
          <div className="space-y-2">
            {recentOrders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {o.customerEmail ?? 'Guest'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatOrderNumber(o.orderNumber)} · {o.provider} ·{' '}
                    {new Date(o.createdAt).toLocaleString()}
                  </p>
                </div>
                <p className="w-20 flex-shrink-0 text-right text-sm font-bold tabular-nums text-foreground">
                  {formatUsd(o.amount)}
                </p>
                <div className="w-36 flex-shrink-0 text-right">
                  <StatusBadge status={o.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionBand>
    </div>
  );
}
