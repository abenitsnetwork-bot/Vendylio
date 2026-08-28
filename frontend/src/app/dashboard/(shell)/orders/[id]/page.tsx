'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { StatusBadge, formatUsd, type SellerOrder } from '@/components/seller/OrdersTable';
import { formatQuantityWithUnit } from '@/lib/productUnits';

interface StatusEvent {
  id: string;
  status: string;
  actorType: string;
  createdAt: string;
}

interface DeliveryInfo {
  id: string;
  status: string;
  provider: string;
  trackingUrl: string | null;
  deliveredAt: string | null;
}

interface NextAction {
  label: string;
  value: string;
  danger?: boolean;
}

// READY and OUT_FOR_DELIVERY are handled separately below (delivery-aware
// buttons) — see the file header for why the generic PATCH transition still
// exists alongside the Phase 5 delivery sub-resource. "Cancel Order" isn't
// in here anymore — cancelling a paid order now always goes through the
// dedicated Refund action below (POST /api/orders/[id]/refund), which
// actually reverses the charge instead of just flipping the status.
const NEXT_ACTIONS: Record<string, NextAction[]> = {
  PAID: [{ label: 'Start Preparing', value: 'PREPARING' }],
  PREPARING: [{ label: 'Mark Ready', value: 'READY' }],
};

// Any status a paid order can still be in when the seller wants to refund it.
const REFUNDABLE_STATUSES = new Set([
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

function deliveryAddressLines(addr: Record<string, unknown> | null): string[] {
  if (!addr) return [];
  const { street, city, state, zip } = addr as Record<string, string | undefined>;
  return [street, [city, state, zip].filter(Boolean).join(', ')].filter((line): line is string =>
    Boolean(line),
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const user = useUser();
  const { logout } = useAuth();
  const [order, setOrder] = useState<SellerOrder | null>(null);
  const [statusEvents, setStatusEvents] = useState<StatusEvent[]>([]);
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(() => {
    api<{ order: SellerOrder; statusEvents: StatusEvent[]; delivery: DeliveryInfo | null }>(
      `/api/orders/${id}`,
    )
      .then((res) => {
        setOrder(res.order);
        setStatusEvents(res.statusEvents);
        setDelivery(res.delivery);
      })
      .catch((err) => {
        const message =
          err instanceof ApiError && err.code === 'ORDER_NOT_FOUND'
            ? 'This order no longer exists.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load this order.';
        setError(message);
      });
  }, [id]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  async function advance(nextStatus: string) {
    setUpdating(true);
    setError(null);
    try {
      await api(`/api/orders/${id}`, { method: 'PATCH', body: { status: nextStatus } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this order.');
    } finally {
      setUpdating(false);
    }
  }

  async function confirmPayment() {
    setUpdating(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/confirm-payment`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm this payment.');
    } finally {
      setUpdating(false);
    }
  }

  async function requestDelivery() {
    setUpdating(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/delivery`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not request delivery.');
    } finally {
      setUpdating(false);
    }
  }

  async function markDelivered() {
    setUpdating(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/delivery`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark this order delivered.');
    } finally {
      setUpdating(false);
    }
  }

  async function refundOrder() {
    if (!window.confirm('Refund this order in full and cancel it? This cannot be undone.')) {
      return;
    }
    setUpdating(true);
    setError(null);
    try {
      await api(`/api/orders/${id}/refund`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not refund this order.');
    } finally {
      setUpdating(false);
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
          <Link
            href="/dashboard/orders"
            className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
          >
            <Icon i="arrow-left" size={16} />
            Back to Orders
          </Link>

          {error && !order && <p className="text-sm text-red-600">{error}</p>}
          {!order && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

          {order && (
            <>
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h1
                    className="mb-2 font-headings font-bold text-foreground"
                    style={{ fontSize: 'clamp(22px, 4vw, 30px)', letterSpacing: '-0.6px' }}
                  >
                    Order #{order.id.slice(-8)}
                  </h1>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={order.status} />
                    <span className="text-xs font-medium text-muted-foreground">
                      {order.fulfillmentMethod === 'PICKUP' ? 'Pickup' : 'Delivery'}
                    </span>
                  </div>
                </div>
                <p className="font-headings text-2xl font-bold text-foreground">
                  {formatUsd(order.amount)}
                </p>
              </div>

              {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

              {order.status === 'PENDING' &&
                (order.provider === 'cashapp_manual' || order.provider === 'zelle_manual') && (
                  <Card className="mb-6">
                    <p className="mb-1 text-sm font-semibold text-foreground">
                      Awaiting {order.provider === 'cashapp_manual' ? 'Cash App' : 'Zelle'} payment
                    </p>
                    <p className="mb-4 text-xs text-muted-foreground">
                      This buyer chose a manual payment method — check your{' '}
                      {order.provider === 'cashapp_manual' ? 'Cash App' : 'Zelle'} account, then
                      confirm once you see {formatUsd(order.amount)} land.
                    </p>
                    <button
                      type="button"
                      disabled={updating}
                      onClick={confirmPayment}
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {updating ? 'Confirming…' : "I've Received This Payment"}
                    </button>
                  </Card>
                )}

              {order.status === 'PENDING' && (
                <Card className="mb-6">
                  <p className="mb-1 text-sm font-semibold text-foreground">
                    Waiting on the customer to complete payment
                  </p>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Nothing has been charged yet. This clears on its own after a while if the
                    customer never comes back — cancel now if you know they won&apos;t.
                  </p>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => advance('CANCELLED')}
                    className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
                  >
                    Cancel Order
                  </button>
                </Card>
              )}

              {NEXT_ACTIONS[order.status] && (
                <Card className="mb-6">
                  <p className="mb-4 text-sm font-semibold text-foreground">Update status</p>
                  <div className="flex flex-wrap gap-3">
                    {NEXT_ACTIONS[order.status]!.map((action) => (
                      <button
                        key={action.value}
                        type="button"
                        disabled={updating}
                        onClick={() => advance(action.value)}
                        className={
                          action.danger
                            ? 'rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50'
                            : 'rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50'
                        }
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </Card>
              )}

              {order.status === 'READY' && (
                <Card className="mb-6">
                  <p className="mb-4 text-sm font-semibold text-foreground">Update status</p>
                  <div className="flex flex-wrap gap-3">
                    {order.fulfillmentMethod === 'PICKUP' ? (
                      <button
                        type="button"
                        disabled={updating}
                        onClick={() => advance('DELIVERED')}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Mark Picked Up
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={updating}
                        onClick={requestDelivery}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Request Delivery
                      </button>
                    )}
                  </div>
                </Card>
              )}

              {order.status === 'OUT_FOR_DELIVERY' && (
                <Card className="mb-6">
                  <p className="mb-4 text-sm font-semibold text-foreground">Update status</p>
                  {delivery && (
                    <p className="mb-4 text-xs text-muted-foreground">
                      Delivery via {delivery.provider.replaceAll('_', ' ')}
                      {delivery.trackingUrl && (
                        <>
                          {' — '}
                          <a href={delivery.trackingUrl} className="text-primary underline">
                            Track
                          </a>
                        </>
                      )}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {delivery?.provider === 'uber_direct' ? (
                      <span className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-muted-foreground">
                        Waiting for courier confirmation
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={updating}
                        onClick={delivery ? markDelivered : () => advance('DELIVERED')}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Mark Delivered
                      </button>
                    )}
                  </div>
                </Card>
              )}

              {REFUNDABLE_STATUSES.has(order.status) && (
                <Card className="mb-6">
                  <p className="mb-4 text-sm font-semibold text-foreground">
                    {order.provider === 'cashapp_manual' || order.provider === 'zelle_manual'
                      ? 'Already refunded this buyer outside Vendylio? Record it here.'
                      : 'Need to cancel? This issues a real refund to the buyer.'}
                  </p>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={refundOrder}
                    className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
                  >
                    {updating ? 'Processing…' : 'Refund Order'}
                  </button>
                </Card>
              )}

              <Card className="mb-6">
                <h2 className="mb-4 border-b border-border pb-4 font-headings text-base font-bold text-foreground">
                  Items
                </h2>
                <div className="space-y-3">
                  {order.lineItems.map((item) => (
                    <div
                      key={`${item.productId}:${item.variantId ?? ''}`}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-foreground">
                        {item.name}
                        {item.variantLabel && (
                          <span className="text-muted-foreground"> ({item.variantLabel})</span>
                        )}{' '}
                        <span className="text-muted-foreground">
                          × {formatQuantityWithUnit(item.quantity, item.unit ?? 'UNIT')}
                        </span>
                      </span>
                      <span className="text-foreground">
                        {formatUsd(item.priceCents * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatUsd(order.subtotalCents)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Delivery</span>
                    <span>{formatUsd(order.deliveryFeeCents)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-foreground">
                    <span>Total</span>
                    <span>{formatUsd(order.amount)}</span>
                  </div>
                  {order.netAmount !== null && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Your payout (after commission)</span>
                      <span>{formatUsd(order.netAmount)}</span>
                    </div>
                  )}
                </div>
              </Card>

              <Card className="mb-6">
                <h2 className="mb-4 border-b border-border pb-4 font-headings text-base font-bold text-foreground">
                  Customer
                </h2>
                <p className="text-sm text-foreground">{order.customerName ?? 'Guest'}</p>
                {order.customerPhone && (
                  <p className="text-sm text-muted-foreground">{order.customerPhone}</p>
                )}
                {order.customerEmail && (
                  <p className="text-sm text-muted-foreground">{order.customerEmail}</p>
                )}
                {deliveryAddressLines(order.deliveryAddress).length > 0 && (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Delivery Address
                    </p>
                    {deliveryAddressLines(order.deliveryAddress).map((line) => (
                      <p key={line} className="text-sm text-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                )}
              </Card>

              {statusEvents.length > 0 && (
                <Card>
                  <h2 className="mb-4 border-b border-border pb-4 font-headings text-base font-bold text-foreground">
                    History
                  </h2>
                  <div className="space-y-3">
                    {statusEvents.map((event) => (
                      <div key={event.id} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{event.status.replaceAll('_', ' ')}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
