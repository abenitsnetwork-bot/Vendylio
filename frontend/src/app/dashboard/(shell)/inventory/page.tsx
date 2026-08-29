'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import type { CategoryOption } from '@/lib/productCategories';
import { StockMovementsDrawer } from '@/components/seller/StockMovementsDrawer';
import { BulkAdjustModal } from '@/components/seller/BulkAdjustModal';

interface InventoryRow {
  productId: string;
  productName: string;
  imageUrl: string | null;
  unit: string;
  categoryName: string | null;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  lowStockThreshold: number | null;
  effectiveThreshold: number;
  status: 'OK' | 'LOW' | 'OUT';
}

const FILTERS = [
  { label: 'All', value: '' },
  { label: 'Low stock', value: 'low' },
  { label: 'Out of stock', value: 'out' },
] as const;

const STATUS_BADGE: Record<InventoryRow['status'], string> = {
  OK: 'bg-secondary text-muted-foreground',
  LOW: 'bg-yellow-100 text-yellow-700',
  OUT: 'bg-red-100 text-red-700',
};

function rowKey(r: { productId: string; variantId: string | null }) {
  return `${r.productId}:${r.variantId ?? ''}`;
}

export default function InventoryPage() {
  const user = useUser();
  const { logout } = useAuth();

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [filter, setFilter] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<{ productId: string; name: string } | null>(null);
  const [savingCell, setSavingCell] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<{ categories: CategoryOption[] }>('/api/categories')
      .then((res) => setCategories(res.categories))
      .catch(() => setCategories([]));
  }, [user]);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ limit: '50' });
      if (q.trim()) p.set('q', q.trim());
      if (categoryId) p.set('categoryId', categoryId);
      if (filter) p.set('filter', filter);
      if (cursor) p.set('cursor', cursor);
      return p.toString();
    },
    [q, categoryId, filter],
  );

  useEffect(() => {
    if (!user) return;
    setError(null);
    setRows(null);
    setSelected(new Set());
    const handle = setTimeout(() => {
      api<{ rows: InventoryRow[]; nextCursor: string | null }>(`/api/inventory?${buildQuery()}`)
        .then((res) => {
          setRows(res.rows);
          setNextCursor(res.nextCursor);
        })
        .catch((err) => {
          setError(err instanceof ApiError ? err.message : "We couldn't load your inventory.");
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [user, buildQuery, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ rows: InventoryRow[]; nextCursor: string | null }>(
        `/api/inventory?${buildQuery(nextCursor)}`,
      );
      setRows((prev) => [...(prev ?? []), ...res.rows]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function saveCell(row: InventoryRow, raw: string) {
    const newQuantity = Number(raw);
    if (!Number.isFinite(newQuantity) || newQuantity < 0 || newQuantity === row.quantity) return;
    const key = rowKey(row);
    setSavingCell(key);
    try {
      await api('/api/inventory/adjust', {
        method: 'POST',
        body: {
          adjustments: [
            {
              productId: row.productId,
              ...(row.variantId ? { variantId: row.variantId } : {}),
              newQuantity,
              reason: 'MANUAL_ADJUST',
            },
          ],
        },
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that quantity.');
    } finally {
      setSavingCell(null);
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!user) return null;

  const selectedRows = (rows ?? []).filter((r) => selected.has(rowKey(r)));

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
              className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
            >
              <Icon i="arrow-left" size={16} />
              Back to Dashboard
            </Link>
            <h1
              className="mb-2 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
            >
              Inventory
            </h1>
            <p className="text-base text-muted-foreground">
              Track stock levels, restock, and see every movement.
            </p>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              placeholder="Search products…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
            />
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value="__none__">Uncategorized</option>
            </select>
            <div className="flex gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
                    filter === f.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-secondary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {selectedRows.length > 0 && (
            <div className="mb-4 flex items-center justify-between rounded-lg border border-primary bg-secondary px-4 py-2.5">
              <span className="text-sm font-medium text-foreground">
                {selectedRows.length} selected
              </span>
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Adjust selection
              </button>
            </div>
          )}

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
          {!error && rows === null && (
            <p className="text-sm text-muted-foreground">Loading inventory…</p>
          )}
          {!error && rows !== null && rows.length === 0 && (
            <div className="rounded-lg border border-border bg-card py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {filter || q || categoryId
                  ? 'No products match these filters.'
                  : 'No products yet.'}
              </p>
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-border bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-3" />
                    <th className="px-3 py-3">Product</th>
                    <th className="px-3 py-3">Category</th>
                    <th className="px-3 py-3">In stock</th>
                    <th className="px-3 py-3">Threshold</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const key = rowKey(row);
                    return (
                      <tr key={key} className="border-b border-border bg-card last:border-0">
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            onChange={() => toggle(key)}
                            aria-label={`Select ${row.productName}`}
                          />
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-medium text-foreground">{row.productName}</p>
                          {row.variantLabel && (
                            <p className="text-xs text-muted-foreground">{row.variantLabel}</p>
                          )}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {row.categoryName ?? '—'}
                        </td>
                        <td className="px-3 py-3">
                          <input
                            type="number"
                            min="0"
                            step={row.unit === 'UNIT' ? '1' : '0.01'}
                            defaultValue={row.quantity}
                            disabled={savingCell === key}
                            onBlur={(e) => saveCell(row, e.target.value)}
                            className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
                            aria-label={`Stock for ${row.productName}`}
                          />
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {row.effectiveThreshold}
                          {row.lowStockThreshold === null && (
                            <span className="ml-1 text-xs">(default)</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[row.status]}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setHistoryFor({ productId: row.productId, name: row.productName })
                            }
                            className="text-xs font-medium text-primary"
                          >
                            History
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rows && rows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Editing a number here records a manual adjustment in the product&apos;s history.
            </p>
          )}

          {nextCursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-4 w-full rounded-lg border border-border bg-card py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>

      {bulkOpen && (
        <BulkAdjustModal
          rows={selectedRows}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            setSelected(new Set());
            setReloadKey((k) => k + 1);
          }}
        />
      )}

      {historyFor && (
        <StockMovementsDrawer
          productId={historyFor.productId}
          productName={historyFor.name}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}
