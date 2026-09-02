'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { StatusBadge, formatUsd } from '@/components/seller/OrdersTable';
import { formatOrderNumber } from '@/lib/orderNumber';

interface AdminOrder {
  id: string;
  orderNumber: number;
  userId: string | null;
  storeId: string;
  storeName: string | null;
  storeSlug: string | null;
  amount: number;
  currency: string;
  status: string;
  customerEmail: string | null;
  provider: string;
  paymentMethod: string | null;
  createdAt: string;
}

interface StoreOption {
  id: string;
  name: string;
  slug: string;
}

const STATUS_FILTERS = [
  '',
  'PENDING',
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'EXPIRED',
  'FAILED',
];

function AdminOrdersInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState('');
  const [storeId, setStoreId] = useState(searchParams.get('storeId') ?? '');
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ stores: StoreOption[] }>('/api/admin/stores/list')
      .then((res) => setStores(res.stores))
      .catch(() => setStores([]));
  }, []);

  const buildQs = useCallback(
    (extra: Record<string, string> = {}) => {
      const qs = new URLSearchParams(extra);
      if (status) qs.set('status', status);
      if (storeId) qs.set('storeId', storeId);
      return qs.toString();
    },
    [status, storeId],
  );

  const load = useCallback(() => {
    setOrders(null);
    setCursor(null);
    setError(null);
    const qs = buildQs();
    api<{ items: AdminOrder[]; nextCursor: string | null }>(
      `/api/admin/orders${qs ? `?${qs}` : ''}`,
    )
      .then((res) => {
        setOrders(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load orders.'));
  }, [buildQs]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ items: AdminOrder[]; nextCursor: string | null }>(
        `/api/admin/orders?${buildQs({ cursor })}`,
      );
      setOrders((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more orders.');
    } finally {
      setLoadingMore(false);
    }
  }

  const activeStore = stores.find((s) => s.id === storeId);

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-6 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Orders
      </h1>

      <div className="mb-4">
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          <option value="">All stores</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {activeStore && (
          <a
            href={`/admin/stores/${activeStore.id}`}
            className="ml-3 text-xs font-semibold text-accent"
          >
            Open {activeStore.name} →
          </a>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
              status === s
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border bg-card text-foreground hover:bg-secondary'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && orders === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!error && orders !== null && orders.length === 0 && (
        <div className="py-16 text-center">
          <Icon i="inbox" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No orders match this filter.</p>
        </div>
      )}
      {orders && orders.length > 0 && (
        <>
          <div className="space-y-2">
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {o.customerEmail ?? 'Guest'}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.storeName ?? 'Unknown store'} · {formatOrderNumber(o.orderNumber)} ·{' '}
                    {o.provider} · {new Date(o.createdAt).toLocaleString()}
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
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-6 w-full rounded-lg border border-border bg-card py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function AdminOrdersPage() {
  return (
    <Suspense fallback={null}>
      <AdminOrdersInner />
    </Suspense>
  );
}
