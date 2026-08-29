'use client';

import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { formatUsdPerUnit } from '@/lib/productUnits';
import { StatusBadge, formatUsd } from '@/components/seller/OrdersTable';
import { formatOrderNumber } from '@/lib/orderNumber';
import { StoreOverviewSection } from '@/components/admin/StoreOverviewSection';

interface Stats {
  merchantCount: number;
  activeStoreCount: number;
  ordersToday: number;
  gmvCents: number;
  platformRevenueCents: number;
  activeDeliveries: number;
  failedPayments: number;
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

const CARDS: {
  key: keyof Stats;
  label: string;
  icon: IconName;
  format: (v: number) => string;
}[] = [
  { key: 'merchantCount', label: 'Merchants', icon: 'briefcase', format: String },
  { key: 'activeStoreCount', label: 'Active Stores', icon: 'store', format: String },
  { key: 'ordersToday', label: "Today's Orders", icon: 'shopping-bag', format: String },
  { key: 'gmvCents', label: 'GMV (all-time)', icon: 'trending-up', format: usd },
  { key: 'platformRevenueCents', label: 'Platform Revenue', icon: 'dollar-sign', format: usd },
  { key: 'activeDeliveries', label: 'Active Deliveries', icon: 'truck', format: String },
  { key: 'failedPayments', label: 'Failed Payments', icon: 'alert-circle', format: String },
];

// Sage/forest/coral slices drawn from the theme tokens in globals.css
// (--color-primary, --color-accent) plus a few in-between tones — recharts
// needs real color strings, not Tailwind classes.
const PIE_COLORS = ['#14201d', '#dd5b2e', '#5c7a6f', '#e3a857', '#9c8b6f', '#756f5e'];

function ChartCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon i={icon} size={16} className="text-muted-foreground" />
        <h2 className="font-headings text-sm font-bold text-foreground">{title}</h2>
      </div>
      {children}
    </Card>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Stats>('/api/admin/stats')
      .then(setStats)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load stats.'));
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

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-8 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Platform Overview
      </h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!stats && <p className="text-sm text-muted-foreground">Loading…</p>}

      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {CARDS.map((c) => (
            <Card key={c.key}>
              <Icon i={c.icon} size={18} className="mb-3 text-muted-foreground" />
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {c.label}
              </p>
              <p className="font-headings text-2xl font-bold text-foreground">
                {c.format(stats[c.key])}
              </p>
            </Card>
          ))}
        </div>
      )}

      <StoreOverviewSection />

      {analytics && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChartCard title="Revenue trend (last 6 months)" icon="trending-up">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={analytics.revenueByMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dbe2d6" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#756f5e' }} />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#756f5e' }}
                      tickFormatter={(v: number) => usd(v)}
                      width={70}
                    />
                    <Tooltip
                      formatter={(v) => usd(Number(v))}
                      contentStyle={{ borderRadius: 10, borderColor: '#dbe2d6' }}
                    />
                    <Area
                      type="monotone"
                      dataKey="gmvCents"
                      name="GMV"
                      stroke="#14201d"
                      fill="#14201d"
                      fillOpacity={0.12}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <ChartCard title="Sales by category" icon="pie-chart">
              {analytics.salesByCategory.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No paid orders yet.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={analytics.salesByCategory}
                      dataKey="revenueCents"
                      nameKey="category"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {analytics.salesByCategory.map((entry, i) => (
                        <Cell
                          key={entry.category}
                          fill={PIE_COLORS[i % PIE_COLORS.length] ?? '#756f5e'}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [usd(Number(value)), String(name)]}
                      contentStyle={{ borderRadius: 10, borderColor: '#dbe2d6' }}
                    />
                    <Legend formatter={(value: string) => value} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="New customers (last 6 months)" icon="users">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analytics.customerGrowthByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dbe2d6" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#756f5e' }} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#756f5e' }}
                    allowDecimals={false}
                    width={30}
                  />
                  <Tooltip contentStyle={{ borderRadius: 10, borderColor: '#dbe2d6' }} />
                  <Bar
                    dataKey="newCustomers"
                    name="New customers"
                    fill="#dd5b2e"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Top-selling products" icon="package">
              {analytics.topProducts.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No paid orders yet.
                </p>
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
                      <p className="flex-shrink-0 text-sm font-bold text-foreground">
                        {usd(p.revenueCents)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}

      <ChartCard title="Recent transactions" icon="shopping-bag">
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
                <p className="w-20 flex-shrink-0 text-right text-sm font-bold text-foreground">
                  {formatUsd(o.amount)}
                </p>
                <div className="w-36 flex-shrink-0 text-right">
                  <StatusBadge status={o.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
