'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { OrdersTable, type SellerOrder } from '@/components/seller/OrdersTable';

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Paid', value: 'PAID' },
  { label: 'Preparing', value: 'PREPARING' },
  { label: 'Ready', value: 'READY' },
  { label: 'Out for Delivery', value: 'OUT_FOR_DELIVERY' },
  { label: 'Delivered', value: 'DELIVERED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'Pending Payment', value: 'PENDING' },
];

const VALID_STATUSES = new Set(STATUS_FILTERS.map((f) => f.value).filter(Boolean));

function OrdersPageInner() {
  const user = useUser();
  const { logout } = useAuth();
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get('status') ?? '';
  const [status, setStatus] = useState(VALID_STATUSES.has(initialStatus) ? initialStatus : '');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback((filterStatus: string, q: string) => {
    setOrders(null);
    setCursor(null);
    setError(null);
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (q) params.set('q', q);
    const qs = params.toString();
    api<{ items: SellerOrder[]; nextCursor: string | null }>(`/api/orders${qs ? `?${qs}` : ''}`)
      .then((res) => {
        setOrders(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load orders.');
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    load(status, query);
  }, [user, status, query, load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const qs = new URLSearchParams({ cursor });
      if (status) qs.set('status', status);
      if (query) qs.set('q', query);
      const res = await api<{ items: SellerOrder[]; nextCursor: string | null }>(
        `/api/orders?${qs.toString()}`,
      );
      setOrders((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more orders.');
    } finally {
      setLoadingMore(false);
    }
  }

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
          <div className="mb-10">
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
              Orders
            </h1>
            <p className="text-base text-muted-foreground">
              Track and fulfill orders from your storefront.
            </p>
          </div>

          <div className="mb-4">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by order number, customer name or email"
              className="w-full rounded-lg border border-border bg-card px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
            />
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
                  status === f.value
                    ? 'border-panel bg-panel text-panel-foreground'
                    : 'border-border bg-card text-foreground hover:bg-secondary'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && orders === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!error && orders !== null && (
            <>
              <OrdersTable orders={orders} />
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
      </div>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersPageInner />
    </Suspense>
  );
}
