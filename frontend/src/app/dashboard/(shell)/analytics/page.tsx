'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { ProUpgradeCard } from '@/components/seller/ProUpgradeCard';
import {
  CHART_ACCENT,
  CHART_AXIS,
  CHART_GRID,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  TOOLTIP_STYLE,
} from '@/components/admin/dashboard/colors';

interface SeriesPoint {
  day: string;
  storeViews: number;
  productViews: number;
  visitors: number;
  orders: number;
  salesCents: number;
}

interface BreakdownRow {
  productId: string;
  name: string;
  category: string;
  unitsSold: number;
  revenueCents: number;
  avgPriceCents: number;
  sharePct: number;
  views: number;
}

interface AnalyticsResponse {
  range: number;
  series: SeriesPoint[];
  totals: {
    views: number;
    storeViews: number;
    productViews: number;
    visitors: number;
    orders: number;
    salesCents: number;
    conversionRate: number;
  };
  topProducts: Array<{ productId: string; name: string; views: number }>;
  productBreakdown: BreakdownRow[];
}

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
] as const;

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
function usd2(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Second-half vs first-half of the window — a trend direction without a
 *  separate previous-period query. null when the first half is empty. */
function halfDelta(values: number[]): number | null {
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  const a = values.slice(0, mid).reduce((s, n) => s + n, 0);
  const b = values.slice(mid).reduce((s, n) => s + n, 0);
  if (a === 0) return b > 0 ? 100 : null;
  return Math.round(((b - a) / a) * 1000) / 10;
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
      style={{
        color: up ? CHART_POSITIVE : CHART_NEGATIVE,
        backgroundColor: up ? 'rgba(21,128,61,0.10)' : 'rgba(185,28,28,0.10)',
      }}
    >
      <Icon i={up ? 'arrow-up' : 'arrow-down'} size={11} />
      {Math.abs(pct)}%
    </span>
  );
}

function KpiCard({
  label,
  icon,
  value,
  sub,
  delta,
}: {
  label: string;
  icon: IconName;
  value: string;
  sub?: string;
  delta: number | null;
}) {
  return (
    <Card className="p-5">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon i={icon} size={14} />
        {label}
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="font-headings text-2xl font-bold text-foreground">{value}</p>
        <DeltaBadge pct={delta} />
      </div>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

/** "Revenue Growth" — the window bucketed into N periods as vertical pills,
 *  the peak highlighted. */
function RevenueGrowth({ series }: { series: SeriesPoint[] }) {
  const buckets = useMemo(() => {
    const n = Math.min(6, series.length);
    if (n === 0) return [];
    const size = Math.ceil(series.length / n);
    const out: { label: string; cents: number }[] = [];
    for (let i = 0; i < series.length; i += size) {
      const slice = series.slice(i, i + size);
      out.push({
        label: shortDay(slice[0]!.day),
        cents: slice.reduce((s, p) => s + p.salesCents, 0),
      });
    }
    return out;
  }, [series]);

  const total = buckets.reduce((s, b) => s + b.cents, 0);
  const max = Math.max(1, ...buckets.map((b) => b.cents));
  const peak = buckets.reduce((m, b, i) => (b.cents > buckets[m]!.cents ? i : m), 0);
  const delta = halfDelta(series.map((p) => p.salesCents));

  return (
    <Card className="flex flex-col p-5 lg:min-h-[360px]">
      <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel text-panel-foreground">
          <Icon i="trending-up" size={13} />
        </span>
        Revenue growth
      </div>
      <p className="font-headings text-3xl font-bold text-foreground">{usd(total)}</p>
      <div className="mb-5 mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <DeltaBadge pct={delta} />
        <span>vs. earlier in period</span>
      </div>

      <div className="mt-auto flex items-end justify-between gap-2 pt-6">
        {buckets.map((b, i) => {
          const h = Math.round((b.cents / max) * 100);
          const isPeak = i === peak && b.cents > 0;
          return (
            <div key={i} className="relative flex flex-1 flex-col items-center gap-2">
              {isPeak && (
                <span className="absolute -top-5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow-sm">
                  {usd(b.cents)}
                </span>
              )}
              <div className="flex h-28 w-7 items-end overflow-hidden rounded-full bg-secondary">
                <div
                  className="w-full rounded-full transition-all"
                  style={{
                    height: `${Math.max(h, b.cents > 0 ? 8 : 0)}%`,
                    backgroundColor: isPeak ? CHART_ACCENT : 'rgba(20,32,29,0.18)',
                  }}
                  title={`${b.label}: ${usd2(b.cents)}`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{b.label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function AnalyticsPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [range, setRange] = useState<number>(30);
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const load = useCallback((r: number) => {
    setData(null);
    setError(null);
    setLocked(false);
    api<AnalyticsResponse>(`/api/analytics?range=${r}`)
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'PLAN_UPGRADE_REQUIRED') {
          setLocked(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Could not load analytics.');
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    load(range);
  }, [user, range, load]);

  const chartData = useMemo(
    () =>
      (data?.series ?? []).map((p) => ({
        label: shortDay(p.day),
        sales: p.salesCents / 100,
        views: p.storeViews + p.productViews,
      })),
    [data],
  );
  const tickInterval = Math.max(0, Math.ceil(chartData.length / 7) - 1);

  if (!user) return null;

  const t = data?.totals;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerHeader
        userName={sellerFirstName(user)}
        userEmail={user.email}
        onSignOut={async () => {
          await logout();
        }}
      />
      <div className="px-4 py-8 lg:px-14 lg:py-12">
        <div className="mx-auto max-w-6xl">
          <Link
            href="/dashboard"
            className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
          >
            <Icon i="arrow-left" size={16} />
            Back to Dashboard
          </Link>

          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1
                className="mb-1 font-headings font-bold text-foreground"
                style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
              >
                Analytics &amp; Reports
              </h1>
              <p className="text-sm text-muted-foreground">
                Traffic, sales and your best-selling products over time.
              </p>
            </div>
            {!locked && !error && (
              <select
                value={range}
                onChange={(e) => setRange(Number(e.target.value))}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground focus:border-panel focus:outline-none"
              >
                {RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {locked && (
            <ProUpgradeCard title="Analytics is a Pro feature">
              See storefront visits, unique visitors, your conversion rate and best-selling products
              over the last 7, 30 or 90 days.
            </ProUpgradeCard>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!locked && !error && !data && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!locked && !error && data && t && (
            <>
              <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                <KpiCard
                  label="Total sales"
                  icon="dollar-sign"
                  value={usd(t.salesCents)}
                  sub={`${t.orders} order${t.orders === 1 ? '' : 's'}`}
                  delta={halfDelta(data.series.map((p) => p.salesCents))}
                />
                <KpiCard
                  label="Storefront views"
                  icon="bar-chart-3"
                  value={t.views.toLocaleString('en-US')}
                  sub={`${t.productViews.toLocaleString('en-US')} product views`}
                  delta={halfDelta(data.series.map((p) => p.storeViews + p.productViews))}
                />
                <KpiCard
                  label="Unique visitors"
                  icon="users"
                  value={t.visitors.toLocaleString('en-US')}
                  delta={halfDelta(data.series.map((p) => p.visitors))}
                />
                <KpiCard
                  label="Conversion"
                  icon="trending-up"
                  value={`${(t.conversionRate * 100).toFixed(1)}%`}
                  sub="orders / visitor"
                  delta={halfDelta(data.series.map((p) => p.orders))}
                />
              </div>

              <div className="mb-6 grid gap-4 lg:grid-cols-3">
                <Card className="p-5 lg:col-span-2">
                  <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel text-panel-foreground">
                      <Icon i="bar-chart-3" size={13} />
                    </span>
                    Sales performance
                  </div>
                  {t.salesCents === 0 ? (
                    <p className="py-20 text-center text-sm text-muted-foreground">
                      No sales in this window yet.
                    </p>
                  ) : (
                    <div style={{ height: 280 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={chartData}
                          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                        >
                          <defs>
                            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.28} />
                              <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={CHART_GRID}
                            vertical={false}
                          />
                          <XAxis
                            dataKey="label"
                            interval={tickInterval}
                            tick={{ fontSize: 11, fill: CHART_AXIS }}
                            tickLine={false}
                            axisLine={{ stroke: CHART_GRID }}
                          />
                          <YAxis
                            width={52}
                            tick={{ fontSize: 11, fill: CHART_AXIS }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v: number) =>
                              v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`
                            }
                          />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(v) => [`$${Number(v).toLocaleString('en-US')}`, 'Sales']}
                          />
                          <Area
                            type="monotone"
                            dataKey="sales"
                            name="Sales"
                            stroke={CHART_ACCENT}
                            strokeWidth={2}
                            fill="url(#salesFill)"
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>

                <RevenueGrowth series={data.series} />
              </div>

              <Card className="p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel text-panel-foreground">
                    <Icon i="pie-chart" size={13} />
                  </span>
                  Product revenue breakdown
                </div>
                {data.productBreakdown.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No sales in this window yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Product</th>
                          <th className="py-2 pr-4 font-medium">Category</th>
                          <th className="py-2 pr-4 text-right font-medium">Units</th>
                          <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                          <th className="py-2 pr-4 text-right font-medium">Avg price</th>
                          <th className="py-2 pr-4 font-medium">Share</th>
                          <th className="py-2 text-right font-medium">Views</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.productBreakdown.map((row) => (
                          <tr key={row.productId} className="border-b border-border/60">
                            <td className="py-3 pr-4 font-semibold text-foreground">{row.name}</td>
                            <td className="py-3 pr-4 text-muted-foreground">{row.category}</td>
                            <td className="py-3 pr-4 text-right tabular-nums text-foreground">
                              {row.unitsSold}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums font-semibold text-foreground">
                              {usd2(row.revenueCents)}
                            </td>
                            <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                              {usd2(row.avgPriceCents)}
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex items-center gap-2">
                                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary">
                                  <span
                                    className="block h-full rounded-full"
                                    style={{
                                      width: `${Math.min(100, row.sharePct)}%`,
                                      backgroundColor: CHART_ACCENT,
                                    }}
                                  />
                                </span>
                                <span className="tabular-nums text-xs text-muted-foreground">
                                  {row.sharePct}%
                                </span>
                              </div>
                            </td>
                            <td className="py-3 text-right tabular-nums text-muted-foreground">
                              {row.views}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
