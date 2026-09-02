'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { ReviewsTable, type SellerReview } from '@/components/seller/ReviewsTable';

export default function ReviewsPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [reviews, setReviews] = useState<SellerReview[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setReviews(null);
    setCursor(null);
    setError(null);
    api<{ items: SellerReview[]; nextCursor: string | null }>('/api/reviews')
      .then((res) => {
        setReviews(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load reviews.');
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
      const res = await api<{ items: SellerReview[]; nextCursor: string | null }>(
        `/api/reviews?cursor=${encodeURIComponent(cursor)}`,
      );
      setReviews((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more reviews.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function onToggleVisible(review: SellerReview) {
    try {
      await api(`/api/reviews/${review.id}`, {
        method: 'PATCH',
        body: { visible: !review.visible },
      });
      setReviews(
        (prev) =>
          prev?.map((r) => (r.id === review.id ? { ...r, visible: !r.visible } : r)) ?? null,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this review.');
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
        <div className="mx-auto max-w-3xl">
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
              Reviews
            </h1>
            <p className="text-base text-muted-foreground">
              Hidden reviews stay off your storefront but remain on record.
            </p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && reviews === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!error && reviews !== null && (
            <>
              <ReviewsTable reviews={reviews} onToggleVisible={onToggleVisible} />
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
