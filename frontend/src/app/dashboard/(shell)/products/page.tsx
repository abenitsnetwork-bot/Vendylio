'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { sellerFirstName } from '@/lib/utils';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { formatUsdPerUnit, formatQuantityWithUnit } from '@/lib/productUnits';
import type { CategoryOption } from '@/lib/productCategories';
import type { ProductFields } from '@/components/seller/ProductForm';

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Inactive', value: 'ARCHIVED' },
] as const;

const UNCATEGORIZED = '__none__';
const VIEW_STORAGE_KEY = 'vendylio-products-view';
type ViewMode = 'grid' | 'list';

interface Group {
  key: string;
  title: string;
  sortOrder: number;
  products: ProductFields[];
}

function groupByCategory(products: ProductFields[], categories: CategoryOption[]): Group[] {
  const order = new Map(categories.map((c) => [c.id, c.sortOrder]));
  const groups = new Map<string, Group>();
  for (const p of products) {
    const key = p.category?.id ?? UNCATEGORIZED;
    const existing = groups.get(key);
    if (existing) {
      existing.products.push(p);
    } else {
      groups.set(key, {
        key,
        title: p.category?.name ?? 'Uncategorized',
        sortOrder: p.category ? (order.get(p.category.id) ?? 999) : 1000,
        products: [p],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export default function ProductsPage() {
  const user = useUser();
  const { logout } = useAuth();

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [products, setProducts] = useState<ProductFields[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [view, setView] = useState<ViewMode>('grid');

  // Hydrate the view preference after mount (localStorage isn't available
  // during SSR).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'grid' || saved === 'list') setView(saved);
    } catch {
      /* private mode / storage blocked — keep the default */
    }
  }, []);

  function chooseView(next: ViewMode) {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!user) return;
    api<{ categories: CategoryOption[] }>('/api/categories')
      .then((res) => setCategories(res.categories))
      .catch(() => setCategories([]));
  }, [user]);

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams({ limit: '50' });
      if (q.trim()) params.set('q', q.trim());
      if (categoryId) params.set('categoryId', categoryId);
      if (status) params.set('status', status);
      if (cursor) params.set('cursor', cursor);
      return params.toString();
    },
    [q, categoryId, status],
  );

  useEffect(() => {
    if (!user) return;
    setError(null);
    setProducts(null);
    const handle = setTimeout(() => {
      api<{ products: ProductFields[]; nextCursor: string | null }>(`/api/products?${buildQuery()}`)
        .then((res) => {
          setProducts(res.products);
          setNextCursor(res.nextCursor);
        })
        .catch((err) => {
          setError(err instanceof ApiError ? err.message : "We couldn't load your products.");
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [user, buildQuery, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ products: ProductFields[]; nextCursor: string | null }>(
        `/api/products?${buildQuery(nextCursor)}`,
      );
      setProducts((prev) => [...(prev ?? []), ...res.products]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't load more products.");
    } finally {
      setLoadingMore(false);
    }
  }

  const groups = useMemo(
    () => (products ? groupByCategory(products, categories) : []),
    [products, categories],
  );

  const filtersActive = Boolean(q.trim() || categoryId || status);

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
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
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
                Your Products
              </h1>
              <p className="text-base text-muted-foreground">
                Edit, replace photos, or remove products from your store.
              </p>
            </div>
            <Link
              href="/dashboard/products/new"
              className="inline-block whitespace-nowrap rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground"
            >
              Add Product
            </Link>
          </div>

          {/* Toolbar */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
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
              <option value={UNCATEGORIZED}>Uncategorized</option>
            </select>
            <div className="flex gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setStatus(f.value)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-semibold ${
                    status === f.value
                      ? 'border-accent bg-accent text-accent-foreground'
                      : 'border-border bg-card text-foreground hover:bg-secondary'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex gap-1 rounded-lg border border-border bg-card p-0.5 sm:ml-auto">
              {[
                { mode: 'grid' as const, icon: 'layout-grid' as const, label: 'Grid view' },
                { mode: 'list' as const, icon: 'list' as const, label: 'List view' },
              ].map((v) => (
                <button
                  key={v.mode}
                  type="button"
                  aria-label={v.label}
                  aria-pressed={view === v.mode}
                  onClick={() => chooseView(v.mode)}
                  className={`flex h-8 w-8 items-center justify-center rounded-md ${
                    view === v.mode
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  <Icon i={v.icon} size={16} />
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-border bg-card py-12 text-center">
              <p className="mb-4 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="text-sm font-medium text-accent"
              >
                Try again
              </button>
            </div>
          )}

          {!error && products === null && (
            <p className="text-sm text-muted-foreground">Loading products…</p>
          )}

          {!error && products !== null && products.length === 0 && filtersActive && (
            <div className="rounded-lg border border-border bg-card py-16 text-center">
              <p className="mb-2 font-headings text-base font-bold text-foreground">
                No products match your filters
              </p>
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  setCategoryId('');
                  setStatus('');
                }}
                className="text-sm font-medium text-accent"
              >
                Clear filters
              </button>
            </div>
          )}

          {!error && products !== null && products.length === 0 && !filtersActive && (
            <div className="rounded-lg border border-border bg-card py-16 text-center">
              <Icon
                i="package"
                size={32}
                className="mx-auto mb-4 text-muted-foreground opacity-50"
              />
              <p className="mb-2 font-headings text-base font-bold text-foreground">
                Your store needs products
              </p>
              <p className="mb-6 text-sm text-muted-foreground">
                Add your first product to start selling — physical goods, services, or local
                offerings all work.
              </p>
              <Link
                href="/dashboard/products/new"
                className="inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground"
              >
                + Add Your First Product
              </Link>
            </div>
          )}

          {products && products.length > 0 && (
            <>
              {groups.map((group) => (
                <section key={group.key} className="mb-10">
                  <h2 className="mb-4 flex items-baseline gap-2 font-headings text-lg font-bold text-foreground">
                    {group.title}
                    <span className="text-sm font-normal text-muted-foreground">
                      {group.products.length}
                    </span>
                  </h2>
                  {view === 'grid' ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {group.products.map((product) => (
                        <Link
                          key={product.id}
                          href={`/dashboard/products/${product.id}/edit`}
                          className="overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-accent"
                        >
                          <div className="relative">
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="aspect-square w-full object-cover"
                              />
                            ) : (
                              <ImagePlaceholder icon="package" className="aspect-square w-full" />
                            )}
                            {product.status === 'ARCHIVED' ? (
                              <span className="absolute right-2 top-2 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                                Inactive
                              </span>
                            ) : (
                              product.quantity <= 0 && (
                                <span className="absolute right-2 top-2 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                                  Sold out
                                </span>
                              )
                            )}
                          </div>
                          <div className="p-2.5">
                            <p className="mb-0.5 truncate text-sm font-semibold text-foreground">
                              {product.name}
                            </p>
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="font-bold text-foreground">
                                {formatUsdPerUnit(product.priceCents, product.unit)}
                              </span>
                              <span className="truncate text-muted-foreground">
                                {formatQuantityWithUnit(product.quantity, product.unit)} in stock
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                      {group.products.map((product) => (
                        <li key={product.id}>
                          <Link
                            href={`/dashboard/products/${product.id}/edit`}
                            className="flex items-center gap-3 p-2.5 transition-colors hover:bg-secondary"
                          >
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt=""
                                className="h-10 w-10 flex-shrink-0 rounded object-cover"
                              />
                            ) : (
                              <ImagePlaceholder
                                icon="package"
                                className="h-10 w-10 flex-shrink-0 rounded"
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-foreground">
                                {product.name}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {formatQuantityWithUnit(product.quantity, product.unit)} in stock
                              </span>
                            </span>
                            {product.status === 'ARCHIVED' ? (
                              <span className="flex-shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                Inactive
                              </span>
                            ) : (
                              product.quantity <= 0 && (
                                <span className="flex-shrink-0 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold text-background">
                                  Sold out
                                </span>
                              )
                            )}
                            <span className="flex-shrink-0 text-sm font-bold text-foreground">
                              {formatUsdPerUnit(product.priceCents, product.unit)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}

              {nextCursor && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mt-2 w-full rounded-lg border border-border bg-card py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
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
