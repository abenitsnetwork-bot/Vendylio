'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { PlanBadge } from '@/components/PlanBadge';
import { formatUsdPerUnit } from '@/lib/productUnits';

interface OverviewStore {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  address: string | null;
  template: string;
  published: boolean;
  plan: string;
  ordersPaused: boolean;
  acceptingOrders: boolean;
  isOpen: boolean;
  openLabel: 'Open' | 'Closed' | 'Paused' | 'Inactive';
  nextOpenLabel: string | null;
  avgRating: number | null;
  reviewCount: number;
  productCount: number;
  paidOrders: number;
  gmvCents: number;
  performance: 'Good' | 'Average' | 'Needs attention';
}

interface Overview {
  summary: {
    totalStores: number;
    activeStores: number;
    inactiveStores: number;
    openStores: number;
    closedStores: number;
    proStores: number;
    totalSalesCents: number;
    totalOrders: number;
    salesGrowthPct: number | null;
    avgRating: number | null;
    topStore: { name: string; slug: string } | null;
  };
  stores: OverviewStore[];
}

function usd(cents: number): string {
  return formatUsdPerUnit(cents, 'UNIT');
}

function compactNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    n,
  );
}

const PERFORMANCE_TONE: Record<OverviewStore['performance'], string> = {
  Good: 'text-green-700',
  Average: 'text-amber-600',
  'Needs attention': 'text-red-600',
};

function StatusPill({ store }: { store: OverviewStore }) {
  const open = store.openLabel === 'Open';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        open ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-green-600' : 'bg-red-500'}`}
        aria-hidden="true"
      />
      {store.openLabel}
    </span>
  );
}

function CountTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'green' | 'red';
}) {
  return (
    <div className="flex flex-col items-center px-2 py-1 text-center">
      <p
        className={`font-headings text-2xl font-bold ${
          tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-600' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function SecondaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function Rating({ store }: { store: OverviewStore }) {
  if (store.avgRating === null) {
    return <span className="text-xs text-muted-foreground">No reviews yet</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon i="star" size={12} className="text-amber-500" />
      <span className="font-semibold text-foreground">{store.avgRating.toFixed(1)}</span>
      <span>({store.reviewCount})</span>
    </span>
  );
}

export function StoreOverviewSection() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>('/api/admin/stores/overview')
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load the store overview.'),
      );
  }, []);

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Link href="/admin/stores" className="text-xs font-semibold text-accent">
          Manage all stores →
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && !data && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <>
          <Card className="mb-4 p-5">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              <CountTile label="Total Stores" value={data.summary.totalStores} />
              <CountTile label="Active" value={data.summary.activeStores} tone="green" />
              <CountTile label="Inactive" value={data.summary.inactiveStores} />
              <CountTile label="Open Now" value={data.summary.openStores} tone="green" />
              <CountTile label="Closed" value={data.summary.closedStores} tone="red" />
              <CountTile label="Pro" value={data.summary.proStores} tone="green" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4 lg:grid-cols-5">
              <SecondaryStat label="Total Sales" value={usd(data.summary.totalSalesCents)} />
              <SecondaryStat label="Total Orders" value={compactNumber(data.summary.totalOrders)} />
              <SecondaryStat
                label="Sales Growth"
                value={
                  data.summary.salesGrowthPct === null
                    ? '—'
                    : `${data.summary.salesGrowthPct > 0 ? '+' : ''}${data.summary.salesGrowthPct}%`
                }
              />
              <SecondaryStat
                label="Avg Rating"
                value={data.summary.avgRating === null ? '—' : `${data.summary.avgRating} / 5`}
              />
              <SecondaryStat label="Top Store" value={data.summary.topStore?.name ?? '—'} />
            </div>
          </Card>

          {data.stores.length === 0 ? (
            <Card className="py-12 text-center">
              <Icon i="store" size={28} className="mx-auto mb-3 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">No stores on the platform yet.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.stores.map((s) => (
                <Card key={s.id} className="flex flex-col gap-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {s.logoUrl ? (
                        <img
                          src={s.logoUrl}
                          alt=""
                          className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-secondary font-headings text-sm font-bold text-foreground">
                          {s.name.charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
                        <Rating store={s} />
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      <StatusPill store={s} />
                      <PlanBadge plan={s.plan} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <p className="text-muted-foreground">Template</p>
                      <p className="font-medium capitalize text-foreground">
                        {s.template.toLowerCase()}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Performance</p>
                      <p className={`font-medium ${PERFORMANCE_TONE[s.performance]}`}>
                        {s.performance}
                      </p>
                    </div>
                    <div className="col-span-2 flex items-start gap-1.5">
                      <Icon
                        i="map-pin"
                        size={12}
                        className="mt-0.5 flex-shrink-0 text-muted-foreground"
                      />
                      <p className="text-foreground">{s.address ?? 'No address on file'}</p>
                    </div>
                    <div className="col-span-2 flex items-center gap-1.5">
                      <Icon i="phone" size={12} className="flex-shrink-0 text-muted-foreground" />
                      <p className="text-foreground">{s.phone ?? 'No phone on file'}</p>
                    </div>
                    <div className="col-span-2 flex items-center gap-1.5">
                      <Icon
                        i="shopping-bag"
                        size={12}
                        className="flex-shrink-0 text-muted-foreground"
                      />
                      <p className="text-foreground">
                        {s.productCount} products · {s.paidOrders} paid orders · {usd(s.gmvCents)}{' '}
                        GMV
                      </p>
                    </div>
                    {!s.isOpen && s.nextOpenLabel && (
                      <p className="col-span-2 text-muted-foreground">{s.nextOpenLabel}</p>
                    )}
                  </div>

                  <div className="mt-auto flex gap-2">
                    <a
                      href={`/s/${s.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 rounded-lg border border-border py-2 text-center text-xs font-semibold text-foreground hover:bg-secondary"
                    >
                      View storefront
                    </a>
                    <Link
                      href={`/admin/stores/${s.id}`}
                      className="flex-1 rounded-lg border border-accent py-2 text-center text-xs font-semibold text-accent hover:bg-secondary"
                    >
                      Manage
                    </Link>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
