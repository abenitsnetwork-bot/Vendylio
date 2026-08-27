'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { StarRatingInput } from '@/components/ui/StarRating';
import { formatUsdPerUnit } from '@/lib/productUnits';
import { guestCsrfHeaderValue } from '@/lib/guestCsrf';
import { CashAppQRCode } from '@/components/storefront/CashAppQRCode';
import { ZellePaymentInfo } from '@/components/storefront/ZellePaymentInfo';

interface TrackedOrder {
  id: string;
  status: string;
  amount: number;
  currency: string;
  lineItems: { productId: string; name: string; priceCents: number; quantity: number }[];
  createdAt: string;
  paidAt: string | null;
  provider: string;
  store: { cashAppCashtag: string | null; zelleContact: string | null };
}

const MANUAL_POLL_INTERVAL_MS = 5000;

const STATUS_COPY: Record<string, { title: string; body: string }> = {
  PENDING: {
    title: 'Payment processing',
    body: "We're confirming your payment — this page updates automatically once it clears.",
  },
  PAID: {
    title: 'Payment received',
    body: 'The seller will reach out with delivery details.',
  },
  PREPARING: { title: 'Being prepared', body: 'The seller is getting your order ready.' },
  READY: { title: 'Ready', body: 'Your order is ready and will be on its way soon.' },
  OUT_FOR_DELIVERY: { title: 'Out for delivery', body: 'Your order is on its way.' },
  DELIVERED: { title: 'Delivered', body: 'Your order has arrived. We hope you loved it!' },
  CANCELLED: { title: 'Cancelled', body: 'This order was cancelled.' },
  EXPIRED: { title: 'Expired', body: 'This order was never paid and has expired.' },
  FAILED: { title: 'Payment failed', body: 'This order could not be paid for.' },
};

/**
 * Guest-facing live order status, shown at
 * /s/[slug]/orders/[orderId]/success — the only page a buyer can revisit
 * (no account, so the URL itself is their "receipt"). Once status reaches
 * DELIVERED, offers the post-delivery review form (Phase 8).
 */
export function OrderStatusTracker({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [hasReview, setHasReview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function load() {
      fetch(`/api/orders/${orderId}/track`)
        .then(async (res) => {
          if (!res.ok) throw new Error('not found');
          return res.json() as Promise<{ order: TrackedOrder; hasReview: boolean }>;
        })
        .then((data) => {
          if (cancelled) return;
          setOrder(data.order);
          setHasReview(data.hasReview);
          // Manual payment methods (Cash App/Zelle) have no webhook — the
          // seller confirms receipt from their own dashboard, so this page
          // polls while PENDING to reflect that the moment it happens,
          // instead of leaving the buyer staring at a stale "processing"
          // screen. Stops as soon as the order leaves PENDING.
          if (data.order.status === 'PENDING') {
            timer = setTimeout(load, MANUAL_POLL_INTERVAL_MS);
          }
        })
        .catch(() => {
          if (!cancelled) setError('Could not load this order.');
        });
    }

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  async function submitReview() {
    if (rating < 1) {
      setReviewError('Pick a star rating.');
      return;
    }
    setSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': guestCsrfHeaderValue() },
        body: JSON.stringify({ rating, ...(text.trim() ? { text: text.trim() } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setReviewError(body.message ?? 'Could not submit your review.');
        setSubmitting(false);
        return;
      }
      setSubmitted(true);
    } catch {
      setReviewError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <p className="mt-2 text-sm text-red-600">{error}</p>;
  if (!order) return <p className="mt-2 text-sm text-muted-foreground">Loading…</p>;

  const isManualPending =
    order.status === 'PENDING' &&
    (order.provider === 'cashapp_manual' || order.provider === 'zelle_manual');
  const copy = isManualPending
    ? {
        title: 'Awaiting payment',
        body: 'Complete the payment below, then the seller will confirm it — this page updates on its own once they do.',
      }
    : (STATUS_COPY[order.status] ?? STATUS_COPY.PAID!);

  return (
    <div className="mt-2 w-full">
      <p className="mb-1 text-sm font-semibold text-foreground">{copy.title}</p>
      <p className="mb-6 text-xs text-muted-foreground">{copy.body}</p>

      {isManualPending && order.provider === 'cashapp_manual' && order.store.cashAppCashtag && (
        <CashAppQRCode cashtag={order.store.cashAppCashtag} amountCents={order.amount} />
      )}
      {isManualPending && order.provider === 'zelle_manual' && order.store.zelleContact && (
        <ZellePaymentInfo contact={order.store.zelleContact} />
      )}

      {order.status === 'DELIVERED' && !hasReview && !submitted && (
        <div className="rounded-lg border border-border bg-card p-5 text-left">
          <p className="mb-3 text-sm font-semibold text-foreground">How was your order?</p>
          <StarRatingInput value={rating} onChange={setRating} />
          <textarea
            className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            placeholder="Optional — tell us more (visible on the seller's storefront)"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {reviewError && <p className="mt-2 text-xs text-red-600">{reviewError}</p>}
          <button
            type="button"
            onClick={submitReview}
            disabled={submitting}
            className="mt-3 w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      )}

      {order.status === 'DELIVERED' && (hasReview || submitted) && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <Icon i="check-circle" size={16} className="text-primary" />
          Thanks for your review!
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        {order.status === 'PENDING' ? 'Total due' : 'Total paid'}:{' '}
        {formatUsdPerUnit(order.amount, 'UNIT')}
      </p>
    </div>
  );
}
