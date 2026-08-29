'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { CartProvider, useCart } from '@/contexts/CartContext';
import { formatUsdPerUnit, formatQuantityWithUnit } from '@/lib/productUnits';
import { guestCsrfHeaderValue } from '@/lib/guestCsrf';

function formatUsd(cents: number): string {
  return formatUsdPerUnit(cents, 'UNIT');
}

interface OrderErrorBody {
  error?: string;
  message?: string;
}

type PaymentMethod = 'card' | 'cashapp' | 'zelle';

function CheckoutFormInner({
  storeSlug,
  storeName,
  cashAppCashtag,
  zelleContact,
  deliveryFeeCents,
  deliveryProvider,
  pickupAddress,
}: {
  storeSlug: string;
  storeName: string;
  cashAppCashtag: string | null;
  zelleContact: string | null;
  deliveryFeeCents: number;
  deliveryProvider: string;
  pickupAddress: string | null;
}) {
  const router = useRouter();
  // fulfillmentMethod lives on the cart context so the buyer's choice on the
  // storefront (StorefrontFulfillmentToggle) carries through to here.
  const { items, subtotalCents, clear, fulfillmentMethod, setFulfillmentMethod } = useCart();
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase D — promo code. `appliedCode` is set only after /validate says OK;
  // the order POST re-checks authoritatively and can still 400 (expired
  // between apply and submit), handled in the error map below.
  const [promoInput, setPromoInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      const res = await fetch(
        `/api/discounts/validate?slug=${encodeURIComponent(storeSlug)}&code=${encodeURIComponent(
          code,
        )}&subtotal=${subtotalCents}`,
        { credentials: 'include' },
      );
      const body = (await res.json().catch(() => ({}))) as {
        valid?: boolean;
        code?: string;
        message?: string;
      };
      if (res.ok && body.valid) {
        setAppliedCode(body.code ?? code.toUpperCase());
        setPromoMsg({ ok: true, text: body.message ?? 'Promo code applied.' });
      } else {
        setAppliedCode(null);
        setPromoMsg({ ok: false, text: body.message ?? 'That promo code is not valid.' });
      }
    } catch {
      setPromoMsg({ ok: false, text: 'Could not check that code. Try again.' });
    } finally {
      setPromoBusy(false);
    }
  }

  function removePromo() {
    setAppliedCode(null);
    setPromoInput('');
    setPromoMsg(null);
  }

  const deliveryAddress = useMemo(
    () => (street || city || state || zip ? { street, city, state, zip } : undefined),
    [street, city, state, zip],
  );
  const addressComplete = Boolean(street.trim() && city.trim() && state.trim() && zip.trim());

  const [liveDeliveryFeeCents, setLiveDeliveryFeeCents] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);

  // Uber Direct prices by real distance — once the buyer finishes typing
  // their address, fetch what delivery will actually cost so the total
  // shown here matches what checkout will charge (rather than the store's
  // flat Store.deliveryFeeCents, which self_manual stores still use as-is).
  useEffect(() => {
    if (
      fulfillmentMethod !== 'delivery' ||
      deliveryProvider !== 'uber_direct' ||
      !addressComplete
    ) {
      setLiveDeliveryFeeCents(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      fetch(`/api/stores/${storeSlug}/delivery-quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': guestCsrfHeaderValue() },
        body: JSON.stringify({
          deliveryAddress: { street, city, state, zip },
          amountCents: subtotalCents,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { feeCents?: number; isEstimate?: boolean } | null) => {
          if (cancelled) return;
          setLiveDeliveryFeeCents(data && !data.isEstimate ? (data.feeCents ?? null) : null);
        })
        .catch(() => {
          if (!cancelled) setLiveDeliveryFeeCents(null);
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setQuoting(false);
    };
  }, [
    fulfillmentMethod,
    deliveryProvider,
    addressComplete,
    street,
    city,
    state,
    zip,
    storeSlug,
    subtotalCents,
  ]);

  const rawDeliveryFeeCents =
    fulfillmentMethod !== 'delivery' ? 0 : (liveDeliveryFeeCents ?? deliveryFeeCents);
  // V1's only promo mechanism, FREE_DELIVERY, waives the whole delivery fee.
  const freeDelivery = appliedCode !== null && fulfillmentMethod === 'delivery';
  const appliedDeliveryFeeCents = freeDelivery ? 0 : rawDeliveryFeeCents;
  const totalCents = subtotalCents + appliedDeliveryFeeCents;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Name and phone are required.');
      return;
    }
    if (fulfillmentMethod === 'delivery' && !deliveryAddress) {
      setError('A delivery address is required, or choose Pickup instead.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-csrf-token': guestCsrfHeaderValue(),
        },
        body: JSON.stringify({
          storeSlug,
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            ...(i.variantId ? { variantId: i.variantId } : {}),
          })),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          ...(customerEmail.trim() ? { customerEmail: customerEmail.trim() } : {}),
          fulfillmentMethod,
          ...(fulfillmentMethod === 'delivery' && deliveryAddress ? { deliveryAddress } : {}),
          ...(appliedCode ? { discountCode: appliedCode } : {}),
          paymentMethod,
        }),
      });

      const body = (await res.json().catch(() => ({}))) as OrderErrorBody & {
        id?: string;
        trackingToken?: string;
        paymentUrl?: string | null;
      };

      if (!res.ok) {
        const map: Record<string, string> = {
          PRODUCT_UNAVAILABLE: body.message ?? 'Something in your cart is no longer available.',
          STORE_NOT_FOUND: 'This store is no longer available.',
          STORE_NOT_ACCEPTING_ORDERS:
            body.message ?? 'This store isn’t accepting orders right now.',
          PAYMENT_PROVIDER_UNCONFIGURED: 'This store cannot accept payments yet.',
          PAYMENT_METHOD_UNAVAILABLE: body.message ?? 'This payment method is not available.',
          PAYMENT_PROVIDER_UNAVAILABLE:
            'Payment is temporarily unavailable. Please try again shortly.',
          PAYMENT_FAILED: 'Payment could not be started. Please try again.',
          DISCOUNT_INVALID:
            body.message ?? 'That promo code can’t be applied — it may have just expired.',
        };
        if (body.error === 'DISCOUNT_INVALID') {
          setAppliedCode(null);
          setPromoMsg({ ok: false, text: 'Promo code removed — it is no longer valid.' });
        }
        setError((body.error && map[body.error]) ?? body.message ?? 'Something went wrong.');
        setSubmitting(false);
        return;
      }

      // Card checkout redirects to Stripe's hosted page; Cash App/Zelle have
      // no external payment page to visit — the buyer pays via the QR/contact
      // info shown on the order's own tracking page (OrderStatusTracker),
      // which is also where they'll see the seller's manual confirmation land.
      if (paymentMethod === 'card') {
        if (!body.paymentUrl) {
          setError('Payment could not be started. Please try again.');
          setSubmitting(false);
          return;
        }
        clear();
        window.location.href = body.paymentUrl;
        return;
      }

      clear();
      router.push(`/s/${storeSlug}/orders/${body.trackingToken}/success`);
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
        <Icon i="shopping-bag" size={32} className="mb-3 text-muted-foreground opacity-50" />
        <p className="mb-4 text-sm text-muted-foreground">Your cart is empty.</p>
        <Link href={`/s/${storeSlug}`} className="text-sm font-semibold text-primary">
          Back to {storeName}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:py-12">
      <Link
        href={`/s/${storeSlug}`}
        className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
      >
        <Icon i="arrow-left" size={16} />
        Back to {storeName}
      </Link>
      <h1
        className="mb-8 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.6px' }}
      >
        Checkout
      </h1>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <form onSubmit={onSubmit} className="space-y-6 lg:col-span-3">
          <Field label="Full Name" htmlFor="customerName">
            <input
              id="customerName"
              className={inputClass}
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </Field>
          <Field label="Phone" htmlFor="customerPhone">
            <input
              id="customerPhone"
              type="tel"
              className={inputClass}
              required
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
            />
          </Field>
          <Field label="Email (optional — for your receipt)" htmlFor="customerEmail">
            <input
              id="customerEmail"
              type="email"
              className={inputClass}
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
            />
          </Field>

          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Fulfillment</p>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-secondary">
                <input
                  type="radio"
                  name="fulfillmentMethod"
                  checked={fulfillmentMethod === 'delivery'}
                  onChange={() => setFulfillmentMethod('delivery')}
                />
                <Icon i="truck" size={16} className="text-muted-foreground" />
                <span className="text-sm text-foreground">
                  Delivery
                  {deliveryProvider === 'uber_direct' ? (
                    <span className="text-muted-foreground"> — priced by address</span>
                  ) : (
                    deliveryFeeCents > 0 && (
                      <span className="text-muted-foreground">
                        {' '}
                        — {formatUsd(deliveryFeeCents)}
                      </span>
                    )
                  )}
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-secondary">
                <input
                  type="radio"
                  name="fulfillmentMethod"
                  checked={fulfillmentMethod === 'pickup'}
                  onChange={() => setFulfillmentMethod('pickup')}
                />
                <Icon i="shopping-bag" size={16} className="text-muted-foreground" />
                <span className="text-sm text-foreground">Pickup — Free</span>
              </label>
            </div>
            {fulfillmentMethod === 'pickup' && pickupAddress && (
              <p className="mt-2 text-xs text-muted-foreground">Pickup at: {pickupAddress}</p>
            )}
          </div>

          {fulfillmentMethod === 'delivery' && (
            <div>
              <p className="mb-3 text-sm font-medium text-foreground">Delivery Address</p>
              <div className="space-y-4">
                <input
                  aria-label="Street address"
                  placeholder="Street address"
                  className={inputClass}
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <input
                    aria-label="City"
                    placeholder="City"
                    className={inputClass}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                  <input
                    aria-label="State"
                    placeholder="State"
                    className={inputClass}
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  />
                  <input
                    aria-label="ZIP code"
                    placeholder="ZIP"
                    className={`${inputClass} col-span-2 sm:col-span-1`}
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Payment Method</p>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-secondary">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={paymentMethod === 'card'}
                  onChange={() => setPaymentMethod('card')}
                />
                <Icon i="credit-card" size={16} className="text-muted-foreground" />
                <span className="text-sm text-foreground">Card</span>
              </label>
              {cashAppCashtag && (
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-secondary">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === 'cashapp'}
                    onChange={() => setPaymentMethod('cashapp')}
                  />
                  <Icon i="phone" size={16} className="text-muted-foreground" />
                  <span className="text-sm text-foreground">Cash App (${cashAppCashtag})</span>
                </label>
              )}
              {zelleContact && (
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-secondary">
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === 'zelle'}
                    onChange={() => setPaymentMethod('zelle')}
                  />
                  <Icon i="phone" size={16} className="text-muted-foreground" />
                  <span className="text-sm text-foreground">Zelle</span>
                </label>
              )}
            </div>
            {paymentMethod !== 'card' && (
              <p className="mt-2 text-xs text-muted-foreground">
                You&apos;ll see the{' '}
                {paymentMethod === 'cashapp' ? 'Cash App QR code' : 'Zelle details'} on the next
                page. The seller confirms your payment manually once they receive it.
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <Button type="submit" disabled={submitting || quoting} className="w-full py-3.5">
            {submitting
              ? 'Please wait…'
              : paymentMethod === 'card'
                ? `Pay ${formatUsd(totalCents)}`
                : `Continue — ${formatUsd(totalCents)}`}
          </Button>
        </form>

        <div className="lg:col-span-2">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 font-headings text-base font-bold text-foreground">
              Order Summary
            </h2>
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={`${item.productId}:${item.variantId ?? ''}`}
                  className="flex justify-between gap-2 text-sm"
                >
                  <span className="text-foreground">
                    {item.name}
                    {item.variantLabel && (
                      <span className="text-muted-foreground"> ({item.variantLabel})</span>
                    )}{' '}
                    <span className="text-muted-foreground">
                      × {formatQuantityWithUnit(item.quantity, item.unit)}
                    </span>
                  </span>
                  <span className="text-foreground">
                    {formatUsd(item.priceCents * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-4">
              {appliedCode ? (
                <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm">
                  <span className="font-semibold text-foreground">
                    Promo <span className="font-mono">{appliedCode}</span>
                  </span>
                  <button
                    type="button"
                    onClick={removePromo}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    aria-label="Promo code"
                    placeholder="Promo code"
                    className={`${inputClass} py-2 text-sm`}
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void applyPromo();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void applyPromo()}
                    disabled={promoBusy || !promoInput.trim()}
                    className="flex-shrink-0 rounded-lg border border-border px-4 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
                  >
                    {promoBusy ? '…' : 'Apply'}
                  </button>
                </div>
              )}
              {promoMsg && (
                <p className={`mt-1.5 text-xs ${promoMsg.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {promoMsg.text}
                </p>
              )}
            </div>

            <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>{formatUsd(subtotalCents)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{fulfillmentMethod === 'pickup' ? 'Pickup' : 'Delivery'}</span>
                <span>
                  {fulfillmentMethod === 'delivery' && quoting ? (
                    'Calculating…'
                  ) : freeDelivery && rawDeliveryFeeCents > 0 ? (
                    <span>
                      <span className="mr-1 text-muted-foreground line-through">
                        {formatUsd(rawDeliveryFeeCents)}
                      </span>
                      <span className="font-semibold text-green-600">Free</span>
                    </span>
                  ) : appliedDeliveryFeeCents > 0 ? (
                    formatUsd(appliedDeliveryFeeCents)
                  ) : (
                    'Free'
                  )}
                </span>
              </div>
              <div className="flex justify-between font-semibold text-foreground">
                <span>Total</span>
                <span>{formatUsd(totalCents)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CheckoutForm({
  storeSlug,
  storeName,
  cashAppCashtag = null,
  zelleContact = null,
  deliveryFeeCents = 0,
  deliveryProvider = 'self_manual',
  pickupAddress = null,
}: {
  storeSlug: string;
  storeName: string;
  cashAppCashtag?: string | null;
  zelleContact?: string | null;
  deliveryFeeCents?: number;
  deliveryProvider?: string;
  pickupAddress?: string | null;
}) {
  return (
    <CartProvider storeSlug={storeSlug}>
      <div className="min-h-screen bg-background font-body">
        <CheckoutFormInner
          storeSlug={storeSlug}
          storeName={storeName}
          cashAppCashtag={cashAppCashtag}
          zelleContact={zelleContact}
          deliveryFeeCents={deliveryFeeCents}
          deliveryProvider={deliveryProvider}
          pickupAddress={pickupAddress}
        />
      </div>
    </CartProvider>
  );
}
