'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { CustomersTable, type SellerCustomer } from '@/components/seller/CustomersTable';

export default function CustomersPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [customers, setCustomers] = useState<SellerCustomer[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setCustomers(null);
    setCursor(null);
    setError(null);
    api<{ items: SellerCustomer[]; nextCursor: string | null }>('/api/customers')
      .then((res) => {
        setCustomers(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load customers.');
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ items: SellerCustomer[]; nextCursor: string | null }>(
        `/api/customers?cursor=${encodeURIComponent(cursor)}`,
      );
      setCustomers((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more customers.');
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
              className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
            >
              <Icon i="arrow-left" size={16} />
              Back to Dashboard
            </Link>
            <h1
              className="mb-2 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
            >
              Customers
            </h1>
            <p className="text-base text-muted-foreground">
              Everyone who has bought from your storefront.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && customers === null && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {!error && customers !== null && (
            <>
              <CustomersTable customers={customers} />
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
