'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { formatUsd, type SellerOrder } from '@/components/seller/OrdersTable';

interface DashboardStore {
  id: string;
  deliveryFeeCents: number;
  deliveryProvider: string;
  pickupAddress: string | null;
}

function OrderRow({
  order,
  actionLabel,
  onAction,
  busy,
  note,
}: {
  order: SellerOrder;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
  /** When set, renders in place of the action button — used for orders a
   * real courier (Uber Direct) handles, where clicking wouldn't do anything
   * useful since completion arrives via webhook, not a seller click. */
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div className="min-w-0 flex-1">
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="truncate text-sm font-semibold text-foreground hover:text-primary"
        >
          {order.customerName ?? 'Guest'}
        </Link>
        <p className="text-xs text-muted-foreground">
          {order.lineItems.length} item{order.lineItems.length === 1 ? '' : 's'} ·{' '}
          {formatUsd(order.amount)}
        </p>
      </div>
      {note ? (
        <span className="flex-shrink-0 text-xs font-medium text-muted-foreground">{note}</span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onAction}
          className="flex-shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default function DeliveryPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [store, setStore] = useState<DashboardStore | null>(null);
  const [feeInput, setFeeInput] = useState('');
  const [providerInput, setProviderInput] = useState('self_manual');
  const [pickupAddressInput, setPickupAddressInput] = useState('');
  const [needsDelivery, setNeedsDelivery] = useState<SellerOrder[] | null>(null);
  const [outForDelivery, setOutForDelivery] = useState<SellerOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api<{ store: DashboardStore }>('/api/stores/me'),
      api<{ items: SellerOrder[] }>('/api/orders?status=READY'),
      api<{ items: SellerOrder[] }>('/api/orders?status=OUT_FOR_DELIVERY'),
    ])
      .then(([storeRes, readyRes, outRes]) => {
        setStore(storeRes.store);
        setFeeInput((storeRes.store.deliveryFeeCents / 100).toFixed(2));
        setProviderInput(storeRes.store.deliveryProvider);
        setPickupAddressInput(storeRes.store.pickupAddress ?? '');
        // PICKUP orders never involve a courier — they don't belong in this
        // page's queues at all (they're managed from the generic Orders
        // list/detail instead, via "Mark Picked Up").
        setNeedsDelivery(readyRes.items.filter((o) => o.fulfillmentMethod !== 'PICKUP'));
        setOutForDelivery(outRes.items.filter((o) => o.fulfillmentMethod !== 'PICKUP'));
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load delivery data.');
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(feeInput) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter a valid delivery fee.');
      return;
    }
    if (providerInput === 'uber_direct' && !pickupAddressInput.trim()) {
      setError('Set a pickup address before switching to Uber Direct.');
      return;
    }
    setSaving(true);
    setError(null);
    setWarning(null);
    try {
      const res = await api<{ deliverabilityWarning?: string }>('/api/stores', {
        method: 'PATCH',
        body: {
          deliveryFeeCents: cents,
          deliveryProvider: providerInput,
          pickupAddress: pickupAddressInput.trim() || null,
        },
      });
      if (res.deliverabilityWarning) setWarning(res.deliverabilityWarning);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save delivery settings.');
    } finally {
      setSaving(false);
    }
  }

  async function requestDelivery(orderId: string) {
    setBusyOrderId(orderId);
    setError(null);
    try {
      await api(`/api/orders/${orderId}/delivery`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not request delivery.');
    } finally {
      setBusyOrderId(null);
    }
  }

  async function markDelivered(orderId: string) {
    setBusyOrderId(orderId);
    setError(null);
    try {
      await api(`/api/orders/${orderId}/delivery`, { method: 'PATCH' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark this order delivered.');
    } finally {
      setBusyOrderId(null);
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
            Delivery
          </h1>
          <p className="mb-10 text-base text-muted-foreground">
            {store?.deliveryProvider === 'uber_direct'
              ? 'A courier picks up and delivers your orders via Uber Direct.'
              : 'You deliver your own orders — no courier setup required.'}
          </p>

          {error && <p className="mb-6 text-sm text-red-600">{error}</p>}
          {warning && (
            <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              ⚠️ {warning}
            </p>
          )}

          <Card className="mb-8 p-8">
            <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
              Delivery Provider
            </h2>
            <form onSubmit={saveSettings}>
              <button
                type="button"
                onClick={() => setProviderInput('self_manual')}
                className={`mb-4 flex w-full items-center justify-between rounded-lg border p-4 text-left ${
                  providerInput === 'self_manual' ? 'border-primary bg-secondary' : 'border-border'
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">Self / Manual</p>
                  <p className="text-xs text-muted-foreground">
                    You deliver orders yourself. Works out of the box.
                  </p>
                </div>
                {providerInput === 'self_manual' && (
                  <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Selected
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setProviderInput('uber_direct')}
                className={`mb-6 flex w-full items-center justify-between rounded-lg border p-4 text-left ${
                  providerInput === 'uber_direct' ? 'border-primary bg-secondary' : 'border-border'
                }`}
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">Uber Direct</p>
                  <p className="text-xs text-muted-foreground">
                    On-demand courier network — a real courier picks up and delivers for you.
                  </p>
                </div>
                {providerInput === 'uber_direct' && (
                  <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Selected
                  </span>
                )}
              </button>

              {providerInput === 'uber_direct' && (
                <Field
                  label="Pickup Address (where the courier collects orders)"
                  htmlFor="pickupAddress"
                >
                  <input
                    id="pickupAddress"
                    type="text"
                    placeholder="123 Main St, Springfield, IL 62704"
                    className={inputClass}
                    value={pickupAddressInput}
                    onChange={(e) => setPickupAddressInput(e.target.value)}
                  />
                </Field>
              )}

              <Field label="Delivery Fee (charged to customers at checkout)" htmlFor="deliveryFee">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground">
                    $
                  </span>
                  <input
                    id="deliveryFee"
                    type="number"
                    min="0"
                    step="0.01"
                    className={`${inputClass} pl-7`}
                    value={feeInput}
                    onChange={(e) => setFeeInput(e.target.value)}
                  />
                </div>
              </Field>
              <Button type="submit" disabled={saving || !store} className="mt-4">
                {saving ? 'Saving…' : 'Save Delivery Settings'}
              </Button>
            </form>
          </Card>

          <Card className="mb-8 p-8">
            <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
              Needs Delivery
            </h2>
            {needsDelivery === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {needsDelivery !== null && needsDelivery.length === 0 && (
              <p className="text-sm text-muted-foreground">No orders ready for delivery.</p>
            )}
            {needsDelivery && needsDelivery.length > 0 && (
              <div className="space-y-2">
                {needsDelivery.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    actionLabel="Request Delivery"
                    onAction={() => requestDelivery(order.id)}
                    busy={busyOrderId === order.id}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card className="p-8">
            <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
              Out for Delivery
            </h2>
            {outForDelivery === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {outForDelivery !== null && outForDelivery.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing out for delivery right now.</p>
            )}
            {outForDelivery && outForDelivery.length > 0 && (
              <div className="space-y-2">
                {outForDelivery.map((order) =>
                  store?.deliveryProvider === 'uber_direct' ? (
                    <OrderRow key={order.id} order={order} note="Waiting for courier" />
                  ) : (
                    <OrderRow
                      key={order.id}
                      order={order}
                      actionLabel="Mark Delivered"
                      onAction={() => markDelivered(order.id)}
                      busy={busyOrderId === order.id}
                    />
                  ),
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
