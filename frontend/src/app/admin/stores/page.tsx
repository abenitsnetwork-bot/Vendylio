'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { PlanBadge } from '@/components/PlanBadge';
import { useAdminAuth } from '@/contexts/AdminContext';

interface AdminStore {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  plan: string;
  createdAt: string;
  ownerId: string;
  ownerEmail: string;
  productCount: number;
  orderCount: number;
}

const PUBLISHED_FILTERS = ['', 'true', 'false'];
const PUBLISHED_LABELS: Record<string, string> = {
  '': 'All stores',
  true: 'Active',
  false: 'Inactive',
};

const PLAN_FILTERS = ['', 'FREE', 'PRO'];
const PLAN_LABELS: Record<string, string> = {
  '': 'All plans',
  FREE: 'Free',
  PRO: 'Pro',
};

export default function AdminStoresPage() {
  const { admin } = useAdminAuth();
  const [q, setQ] = useState('');
  const [published, setPublished] = useState('');
  const [plan, setPlan] = useState('');
  const [stores, setStores] = useState<AdminStore[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const buildQs = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        ...(q ? { q } : {}),
        ...(published ? { published } : {}),
        ...(plan ? { plan } : {}),
        ...extra,
      });
      return params.toString();
    },
    [q, published, plan],
  );

  const load = useCallback(() => {
    setStores(null);
    setCursor(null);
    setError(null);
    api<{ items: AdminStore[]; nextCursor: string | null }>(`/api/admin/stores?${buildQs()}`)
      .then((res) => {
        setStores(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load stores.'));
  }, [buildQs]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ items: AdminStore[]; nextCursor: string | null }>(
        `/api/admin/stores?${buildQs({ cursor })}`,
      );
      setStores((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more stores.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function togglePublished(store: AdminStore) {
    setError(null);
    setBusyId(store.id);
    try {
      const res = await api<{ store: { id: string; published: boolean } }>(
        `/api/admin/stores/${store.id}`,
        { method: 'PATCH', body: { published: !store.published } },
      );
      setStores((prev) =>
        prev
          ? prev.map((s) => (s.id === store.id ? { ...s, published: res.store.published } : s))
          : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this store.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteStore(store: AdminStore) {
    if (
      !confirm(
        `Delete "${store.name}" permanently? This removes its products, customers and reviews. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(store.id);
    try {
      await api(`/api/admin/stores/${store.id}`, { method: 'DELETE' });
      setStores((prev) => (prev ? prev.filter((s) => s.id !== store.id) : prev));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this store.');
    } finally {
      setBusyId(null);
    }
  }

  const canDelete = admin?.role === 'SUPERADMIN';

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-6 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Stores
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="mb-6 flex flex-wrap gap-3"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or slug…"
          className="min-w-48 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <select
          value={published}
          onChange={(e) => setPublished(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          {PUBLISHED_FILTERS.map((p) => (
            <option key={p} value={p}>
              {PUBLISHED_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
          aria-label="Filter by plan"
        >
          {PLAN_FILTERS.map((p) => (
            <option key={p} value={p}>
              {PLAN_LABELS[p]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Search
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!error && stores === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!error && stores !== null && stores.length === 0 && (
        <div className="py-16 text-center">
          <Icon i="store" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No stores match this filter.</p>
        </div>
      )}
      {stores && stores.length > 0 && (
        <>
          <div className="space-y-2">
            {stores.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <Link
                  href={`/admin/stores/${s.id}`}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm hover:text-primary"
                >
                  <span className="font-semibold text-foreground">{s.name}</span>
                  <span className="text-muted-foreground">›</span>
                  <span className="truncate text-xs text-muted-foreground">{s.ownerEmail}</span>
                  <span className="text-muted-foreground">›</span>
                  <PlanBadge plan={s.plan} />
                  <span className="text-xs font-medium text-muted-foreground">
                    {s.productCount} products · {s.orderCount} orders
                  </span>
                </Link>

                <div className="flex flex-shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      s.published ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {s.published ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => void togglePublished(s)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                      s.published
                        ? 'border-red-200 text-red-600 hover:bg-red-50'
                        : 'border-primary text-primary hover:bg-secondary'
                    }`}
                  >
                    {busyId === s.id ? 'Saving…' : s.published ? 'Deactivate' : 'Activate'}
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      disabled={busyId === s.id}
                      onClick={() => void deleteStore(s)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
                    >
                      Delete
                    </button>
                  )}
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
