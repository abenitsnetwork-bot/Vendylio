'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { StarRatingInput } from '@/components/ui/StarRating';
import { formatUsdPerUnit } from '@/lib/productUnits';
import { guestCsrfHeaderValue } from '@/lib/guestCsrf';
import { CashAppQRCode } from '@/components/storefront/CashAppQRCode';
import { ZellePaymentInfo } from '@/components/storefront/ZellePaymentInfo';
import { OrderTimeline } from '@/components/storefront/OrderTimeline';

interface TimelineStep {
  key: string;
  label: string;
  state: 'done' | 'current' | 'upcoming';
  at: string | null;
}

interface TrackedOrder {
  reference: string;
  placedAt: string;
  paidAt: string | null;
  fulfillmentMethod: 'PICKUP' | 'DELIVERY';
  status: { key: string; label: string; description: string };
  closed: boolean;
  isManualPaymentPending: boolean;
  provider: string;
  items: {
    name: string;
    quantity: number;
    unit: string;
    variantLabel: string | null;
    lineTotalCents: number;
  }[];
  totals: {
    subtotalCents: number;
    deliveryFeeCents: number;
    taxCents: number;
    totalCents: number;
    currency: string;
  };
  deliveryAddress: Record<string, unknown> | null;
  delivery: {
    status: string;
    stage: string | null;
    providerName: string | null;
    trackingUrl: string | null;
    etaAt: string | null;
  } | null;
  timeline: TimelineStep[];
  store: {
    name: string;
    slug: string;
    phone: string | null;
    pickupAddress: string | null;
    pickupInstructions: string | null;
    cashAppCashtag: string | null;
    zelleContact: string | null;
  };
}

// Fast poll only while a manual (Cash App / Zelle) payment is pending — the
// seller confirms it by hand, no webhook, so the buyer is actively waiting.
const MANUAL_POLL_MS = 5000;
// Gentle poll while the order is in flight so a merchant status change shows
// up without a manual refresh — conservative, and it stops at a terminal
// state (§182). No realtime infra in the stack, so this is the fallback (§17).
const ACTIVE_POLL_MS = 25000;

function usd(cents: number): string {
  return formatUsdPerUnit(cents, 'UNIT');
}

function addressLines(addr: Record<string, unknown> | null): string[] {
  if (!addr) return [];
  const { street, city, state, zip } = addr as Record<string, string | undefined>;
  return [street, [city, state, zip].filter(Boolean).join(', ')].filter((line): line is string =>
    Boolean(line),
  );
}

/**
 * Guest-facing live order status, shown at
 * /s/[slug]/orders/[token]/success. The `token` is the buyer's only
 * credential (no account). Once status reaches DELIVERED, offers the
 * post-delivery review form.
 */
export function OrderStatusTracker({ token }: { token: string }) {
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [hasReview, setHasReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const announcedStatus = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const load = useCallback(async (): Promise<TrackedOrder | null> => {
    const res = await fetch(`/api/orders/track/${token}`);
    if (!res.ok) throw new Error('not found');
    const data = (await res.json()) as { order: TrackedOrder; hasReview: boolean };
    setOrder(data.order);
    setHasReview(data.hasReview);
    // Accessible announcement only when the status actually changes (§39).
    if (announcedStatus.current && announcedStatus.current !== data.order.status.key) {
      setAnnouncement(`Order status updated: ${data.order.status.label}.`);
    }
    announcedStatus.current = data.order.status.key;
    return data.order;
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(current: TrackedOrder | null) {
      if (cancelled || !current) return;
      const done =
        current.closed ||
        current.status.key === 'DELIVERED' ||
        current.status.key === 'PAYMENT_FAILED';
      if (done) return;
      const delay = current.isManualPaymentPending ? MANUAL_POLL_MS : ACTIVE_POLL_MS;
      timer = setTimeout(() => {
        load()
          .then((next) => schedule(next))
          .catch(() => {
            /* keep the last good render; a manual refresh is always available */
          });
      }, delay);
    }

    load()
      .then((next) => schedule(next))
      .catch(() => {
        if (!cancelled) setError("We couldn't find this order.");
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  async function manualRefresh() {
    setRefreshing(true);
    try {
      await load();
      setError(null);
    } catch {
      setError("We couldn't refresh this order. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }

  async function submitReview() {
    if (rating < 1) {
      setReviewError('Pick a star rating.');
      return;
    }
    setSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch(`/api/orders/track/${token}/review`, {
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

  if (error && !order) return <p className="mt-2 text-sm text-red-600">{error}</p>;
  if (!order) return <p className="mt-2 text-sm text-muted-foreground">Loading…</p>;

  const isPickup = order.fulfillmentMethod === 'PICKUP';
  const showTimeline = !order.isManualPaymentPending && !order.closed;
  const deliveryAddr = addressLines(order.deliveryAddress);

  return (
    <div className="mt-2 w-full max-w-md text-left">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <p className="text-xs font-medium text-muted-foreground">Order {order.reference}</p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-foreground">{order.status.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{order.status.description}</p>
        </div>
        {showTimeline && (
          <button
            type="button"
            onClick={manualRefresh}
            disabled={refreshing}
            className="flex-shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {isPickup &&
        !order.closed &&
        (order.store.pickupAddress || order.store.pickupInstructions) && (
          <div className="mt-3 space-y-1 rounded-lg bg-secondary px-3 py-2 text-xs text-foreground">
            {order.store.pickupAddress && (
              <p>
                <span className="font-semibold">Pickup location:</span> {order.store.pickupAddress}
              </p>
            )}
            {order.store.pickupInstructions && (
              <p>
                <span className="font-semibold">Instructions:</span>{' '}
                {order.store.pickupInstructions}
              </p>
            )}
          </div>
        )}

      {order.isManualPaymentPending &&
        order.provider === 'cashapp_manual' &&
        order.store.cashAppCashtag && (
          <div className="mt-4">
            <CashAppQRCode
              cashtag={order.store.cashAppCashtag}
              amountCents={order.totals.totalCents}
            />
          </div>
        )}
      {order.isManualPaymentPending &&
        order.provider === 'zelle_manual' &&
        order.store.zelleContact && (
          <div className="mt-4">
            <ZellePaymentInfo contact={order.store.zelleContact} />
          </div>
        )}

      {showTimeline && order.timeline.length > 0 && (
        <div className="mt-5">
          <OrderTimeline steps={order.timeline} />
        </div>
      )}

      {!isPickup && order.delivery && order.status.key !== 'DELIVERED' && !order.closed && (
        <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <p className="font-medium text-foreground">
            {order.delivery.stage ?? 'Delivery'}
            {order.delivery.providerName ? ` · ${order.delivery.providerName}` : ''}
          </p>
          {order.delivery.etaAt && new Date(order.delivery.etaAt).getTime() > Date.now() && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Estimated arrival{' '}
              {new Date(order.delivery.etaAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
          {order.delivery.trackingUrl && (
            <a
              href={order.delivery.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
            >
              Track your delivery
            </a>
          )}
        </div>
      )}

      {order.delivery?.status === 'FAILED' && order.status.key !== 'DELIVERED' && (
        <p className="mt-4 rounded-lg bg-secondary px-3 py-2 text-xs text-foreground">
          We&apos;re having trouble completing your delivery. {order.store.name} has been notified
          and is working on it.
        </p>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Order summary
        </p>
        <div className="space-y-1.5 text-sm">
          {order.items.map((it, i) => (
            <div key={`${it.name}-${i}`} className="flex justify-between gap-3">
              <span className="text-foreground">
                {it.name}
                {it.variantLabel ? ` (${it.variantLabel})` : ''}{' '}
                <span className="text-muted-foreground">
                  {it.unit && it.unit !== 'UNIT'
                    ? `${it.quantity} ${it.unit.toLowerCase()}`
                    : `×${it.quantity}`}
                </span>
              </span>
              <span className="whitespace-nowrap text-foreground">{usd(it.lineTotalCents)}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{usd(order.totals.subtotalCents)}</span>
          </div>
          {order.totals.deliveryFeeCents > 0 && (
            <div className="flex justify-between">
              <span>Delivery</span>
              <span>{usd(order.totals.deliveryFeeCents)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-semibold text-foreground">
            <span>{order.status.key === 'PROCESSING' ? 'Total due' : 'Total'}</span>
            <span>{usd(order.totals.totalCents)}</span>
          </div>
        </div>
      </div>

      {!isPickup && deliveryAddr.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Delivery to
          </p>
          {deliveryAddr.map((line) => (
            <p key={line} className="text-sm text-foreground">
              {line}
            </p>
          ))}
        </div>
      )}

      {order.status.key === 'DELIVERED' && !hasReview && !submitted && (
        <div className="mt-5 rounded-lg border border-border bg-card p-5">
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

      {order.status.key === 'DELIVERED' && (hasReview || submitted) && (
        <div className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          <Icon i="check-circle" size={16} className="text-primary" />
          Thanks for your review!
        </div>
      )}

      <p className="mt-5 text-xs text-muted-foreground">
        Need help with your order?{' '}
        {order.store.phone ? (
          <>
            Call {order.store.name} at {order.store.phone}.
          </>
        ) : (
          <>Contact {order.store.name}.</>
        )}
      </p>
    </div>
  );
}
