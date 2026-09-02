'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { ProUpgradeCard } from '@/components/seller/ProUpgradeCard';

interface SeriesPoint {
  day: string;
  storeViews: number;
  productViews: number;
  visitors: number;
  orders: number;
  salesCents: number;
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
}

const RANGES = [7, 30, 90] as const;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ViewsChart({ series }: { series: SeriesPoint[] }) {
  const max = Math.max(1, ...series.map((p) => p.storeViews + p.productViews));
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[520px] items-end gap-1" style={{ height: 160 }}>
        {series.map((p) => {
          const total = p.storeViews + p.productViews;
          const h = Math.round((total / max) * 100);
          return (
            <div key={p.day} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-primary/70"
                style={{ height: `${h}%`, minHeight: total > 0 ? 2 : 0 }}
                title={`${p.day}: ${total} views, ${p.visitors} visitors, ${p.orders} orders`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex min-w-[520px] justify-between text-[10px] text-muted-foreground">
        <span>{series[0]?.day}</span>
        <span>{series[series.length - 1]?.day}</span>
      </div>
    </div>
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
          <div className="mb-8">
            <Link
              href="/dashboard"
              className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
            >
              <Icon i="arrow-left" size={16} />
              Back to Dashboard
            </Link>
            <h1
              className="mb-2 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
            >
              Analytics
            </h1>
            <p className="text-base text-muted-foreground">
              How much traffic your storefront gets and how it converts.
            </p>
          </div>

          {locked && (
            <ProUpgradeCard title="Analytics is a Pro feature">
              See storefront visits, unique visitors, your conversion rate and best-selling products
              over the last 7, 30 or 90 days.
            </ProUpgradeCard>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {!locked && !error && (
            <>
              <div className="mb-6 flex gap-2">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      range === r
                        ? 'bg-accent text-accent-foreground'
                        : 'border border-border text-muted-foreground hover:bg-secondary'
                    }`}
                  >
                    {r}d
                  </button>
                ))}
              </div>

              {!data && <p className="text-sm text-muted-foreground">Loading…</p>}

              {data && (
                <>
                  <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <Card>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        Storefront views
                      </p>
                      <p className="font-headings text-2xl font-bold text-foreground">
                        {data.totals.storeViews}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        + {data.totals.productViews} product views
                      </p>
                    </Card>
                    <Card>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        Unique visitors
                      </p>
                      <p className="font-headings text-2xl font-bold text-foreground">
                        {data.totals.visitors}
                      </p>
                    </Card>
                    <Card>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        Orders
                      </p>
                      <p className="font-headings text-2xl font-bold text-foreground">
                        {data.totals.orders}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {usd(data.totals.salesCents)}
                      </p>
                    </Card>
                    <Card>
                      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                        Conversion
                      </p>
                      <p className="font-headings text-2xl font-bold text-foreground">
                        {(data.totals.conversionRate * 100).toFixed(1)}%
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">orders / visitor</p>
                    </Card>
                  </div>

                  <Card className="mb-8">
                    <h2 className="mb-4 font-headings text-lg font-bold text-foreground">
                      Views per day
                    </h2>
                    <ViewsChart series={data.series} />
                  </Card>

                  <Card>
                    <h2 className="mb-4 font-headings text-lg font-bold text-foreground">
                      Top products
                    </h2>
                    {data.topProducts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No product views in this window yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {data.topProducts.map((p) => (
                          <div
                            key={p.productId}
                            className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
                          >
                            <span className="font-medium text-foreground">{p.name}</span>
                            <span className="text-muted-foreground">{p.views} views</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
