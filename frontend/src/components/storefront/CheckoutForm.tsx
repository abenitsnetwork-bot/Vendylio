'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
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

interface DeliveryOption {
  method: 'DELIVERY' | 'PICKUP';
  provider: string;
  friendlyName: string;
  quoteId: string | null;
  feeCents: number;
  serviceable: boolean;
  isEstimate: boolean;
  estimatedDropoffAt: string | null;
  unserviceableReason?: string;
}
interface DeliveryQuoteResponse {
  options: DeliveryOption[];
  customerChoosesProvider: boolean;
  deliveryUnavailable: boolean;
  notServiceable: boolean;
}

function etaLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (mins <= 0 || mins > 240) return null;
  return `~${mins} min`;
}

type CartChange =
  | 'REMOVED'
  | 'OPTION_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'STOCK_REDUCED'
  | 'PRICE_INCREASED'
  | 'PRICE_DECREASED';

interface CartValidation {
  storeOk: boolean;
  acceptingOrders: boolean;
  pauseMessage: string | null;
  hasBlockingChange: boolean;
  hasPriceIncrease: boolean;
  lines: {
    productId: string;
    variantId: string | null;
    ok: boolean;
    name: string;
    currentPriceCents: number;
    availableQuantity: number;
    adjustedQuantity: number;
    changes: CartChange[];
  }[];
}

const CHANGE_COPY: Record<
  CartChange,
  (name: string, line: CartValidation['lines'][number]) => string
> = {
  REMOVED: (n) => `${n} is no longer available and was removed.`,
  OPTION_UNAVAILABLE: (n) => `The option you chose for ${n} is no longer available.`,
  OUT_OF_STOCK: (n) => `${n} just sold out.`,
  STOCK_REDUCED: (n, l) => `Only ${l.availableQuantity} of ${n} left — we lowered your quantity.`,
  PRICE_INCREASED: (n, l) => `The price of ${n} changed to ${formatUsd(l.currentPriceCents)}.`,
  PRICE_DECREASED: (n, l) => `Good news — ${n} is now ${formatUsd(l.currentPriceCents)}.`,
};

/** A colourful radio option row — a branded icon chip on the left, a custom
 * dot on the right, tinted card when selected. Shared by the Fulfillment
 * and Payment Method groups. */
function OptionCard({
  name,
  checked,
  onSelect,
  icon,
  tone,
  title,
  subtitle,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  icon: IconName;
  /** brand-ish bg for the icon chip, e.g. "bg-primary", "bg-green-600" */
  tone: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
        checked
          ? 'border-primary bg-secondary shadow-sm'
          : 'border-border hover:border-primary/50 hover:bg-secondary/40'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <span
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-white ${tone}`}
      >
        <Icon i={icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? 'border-primary' : 'border-border'
        }`}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </span>
    </label>
  );
}

function CheckoutFormInner({
  storeSlug,
  linkBase,
  storeName,
  cashAppCashtag,
  zelleContact,
  deliveryFeeCents,
  pickupAddress,
}: {
  storeSlug: string;
  /** Phase 4b — `/s/<slug>` on the platform domain, `''` on a custom domain. */
  linkBase: string;
  storeName: string;
  cashAppCashtag: string | null;
  zelleContact: string | null;
  deliveryFeeCents: number;
  /** Legacy prop — kept for caller compatibility, the engine resolves the
   *  provider server-side now. */
  deliveryProvider?: string;
  pickupAddress: string | null;
}) {
  const router = useRouter();
  // fulfillmentMethod lives on the cart context so the buyer's choice on the
  // storefront (StorefrontUtilityBar) carries through to here.
  const { items, subtotalCents, fulfillmentMethod, setFulfillmentMethod, updateItem, removeItem } =
    useCart();
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

  // Prompt #12 — the live delivery options for the typed address.
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[] | null>(null);
  const [deliveryUnavailable, setDeliveryUnavailable] = useState(false);
  const [customerChoosesProvider, setCustomerChoosesProvider] = useState(false);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedProviderType, setSelectedProviderType] = useState<string | null>(null);
  const [quoteNonce, setQuoteNonce] = useState(0);

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

  // Pre-payment cart revalidation (§38-41 / §115-117). POST /api/orders is
  // still the gate — this reconciles localStorage prices/stock with the DB so
  // the buyer sees and fixes any drift before paying, not at the "Pay" click.
  const [validation, setValidation] = useState<CartValidation | null>(null);
  const [priceAck, setPriceAck] = useState(false);

  const runValidation = useCallback(async () => {
    if (items.length === 0) return;
    try {
      const res = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': guestCsrfHeaderValue() },
        body: JSON.stringify({
          storeSlug,
          items: items.map((i) => ({
            productId: i.productId,
            ...(i.variantId ? { variantId: i.variantId } : {}),
            quantity: i.quantity,
            priceCents: i.priceCents,
          })),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as CartValidation;
      setValidation(data);
      // Silently reconcile the cart to the live numbers: new price, lowered
      // stock cap. Removals stay flagged for the buyer to confirm.
      for (const line of data.lines) {
        const patch: Parameters<typeof updateItem>[2] = {};
        if (line.changes.includes('PRICE_INCREASED') || line.changes.includes('PRICE_DECREASED')) {
          patch.priceCents = line.currentPriceCents;
        }
        if (line.changes.includes('STOCK_REDUCED')) {
          patch.maxQuantity = line.availableQuantity;
        }
        if (Object.keys(patch).length > 0) {
          updateItem(line.productId, line.variantId ?? undefined, patch);
        }
      }
      if (!data.lines.some((l) => l.changes.includes('PRICE_INCREASED'))) setPriceAck(false);
    } catch {
      // Offline / transient — the order POST still revalidates authoritatively.
    }
  }, [items, storeSlug, updateItem]);

  useEffect(() => {
    const t = setTimeout(runValidation, 400);
    return () => clearTimeout(t);
  }, [runValidation]);

  const blockedLines = validation?.lines.filter((l) => !l.ok) ?? [];
  const adjustedLines = validation?.lines.filter((l) => l.ok && l.changes.length > 0) ?? [];
  const storePaused = validation ? !validation.acceptingOrders : false;
  const needsPriceAck = Boolean(validation?.hasPriceIncrease) && !priceAck;
  const checkoutBlocked = Boolean(validation?.hasBlockingChange) || storePaused;

  function removeBlockedItems() {
    for (const line of blockedLines) {
      removeItem(line.productId, line.variantId ?? undefined);
    }
  }

  const deliveryAddress = useMemo(
    () => (street || city || state || zip ? { street, city, state, zip } : undefined),
    [street, city, state, zip],
  );
  const addressComplete = Boolean(street.trim() && city.trim() && state.trim() && zip.trim());

  const [quoting, setQuoting] = useState(false);

  // Prompt #12 — once the buyer finishes typing their address, fetch every
  // serviceable delivery option (Uber / DoorDash / merchant) so the fee +
  // ETA shown here match what checkout will charge. A slow/erroring provider
  // just drops out; if none can service the address, only pickup remains.
  useEffect(() => {
    if (fulfillmentMethod !== 'delivery' || !addressComplete) {
      setDeliveryOptions(null);
      setDeliveryUnavailable(false);
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
        .then((data: DeliveryQuoteResponse | null) => {
          if (cancelled) return;
          const opts = (data?.options ?? []).filter((o) => o.method === 'DELIVERY');
          setDeliveryOptions(opts);
          setCustomerChoosesProvider(Boolean(data?.customerChoosesProvider));
          setDeliveryUnavailable(Boolean(data?.deliveryUnavailable));
        })
        .catch(() => {
          if (!cancelled) {
            setDeliveryOptions(null);
            setDeliveryUnavailable(false);
          }
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
    addressComplete,
    street,
    city,
    state,
    zip,
    storeSlug,
    subtotalCents,
    quoteNonce,
  ]);

  const serviceableOptions = useMemo(
    () => (deliveryOptions ?? []).filter((o) => o.serviceable),
    [deliveryOptions],
  );
  const showProviderPicker = customerChoosesProvider && serviceableOptions.length > 1;

  // Auto-pick the cheapest serviceable option (or honour the buyer's pick when
  // it is still valid).
  useEffect(() => {
    if (fulfillmentMethod !== 'delivery' || serviceableOptions.length === 0) {
      setSelectedQuoteId(null);
      setSelectedProviderType(null);
      return;
    }
    const stillValid = serviceableOptions.find((o) => o.provider === selectedProviderType);
    const pick =
      showProviderPicker && stillValid
        ? stillValid
        : serviceableOptions.reduce((a, b) => (b.feeCents < a.feeCents ? b : a));
    setSelectedQuoteId(pick.quoteId);
    setSelectedProviderType(pick.provider);
  }, [serviceableOptions, showProviderPicker, selectedProviderType, fulfillmentMethod]);

  const selectedOption =
    serviceableOptions.find((o) => o.provider === selectedProviderType) ?? null;

  const rawDeliveryFeeCents =
    fulfillmentMethod !== 'delivery'
      ? 0
      : selectedOption
        ? selectedOption.feeCents
        : deliveryFeeCents;
  // V1's only promo mechanism, FREE_DELIVERY, waives the whole delivery fee.
  const freeDelivery = appliedCode !== null && fulfillmentMethod === 'delivery';
  const appliedDeliveryFeeCents = freeDelivery ? 0 : rawDeliveryFeeCents;
  const totalCents = subtotalCents + appliedDeliveryFeeCents;
  const deliveryBlocked =
    fulfillmentMethod === 'delivery' && addressComplete && !quoting && deliveryUnavailable;

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
    if (deliveryBlocked) {
      setError('Delivery isn’t available for this address — try another address or choose Pickup.');
      return;
    }
    if (checkoutBlocked || needsPriceAck) {
      setError('Please resolve the changes to your cart above before continuing.');
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
          ...(fulfillmentMethod === 'delivery' && selectedQuoteId
            ? { quoteId: selectedQuoteId }
            : {}),
          ...(fulfillmentMethod === 'delivery' &&
          selectedProviderType &&
          selectedProviderType !== 'PICKUP'
            ? { deliveryProviderType: selectedProviderType }
            : {}),
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
          DELIVERY_UNAVAILABLE:
            body.message ??
            'Delivery isn’t available for this address — try Pickup or a new address.',
          DELIVERY_QUOTE_INVALID:
            'Your delivery quote expired. We’ve refreshed it — please review and try again.',
        };
        if (body.error === 'DISCOUNT_INVALID') {
          setAppliedCode(null);
          setPromoMsg({ ok: false, text: 'Promo code removed — it is no longer valid.' });
        }
        if (body.error === 'DELIVERY_UNAVAILABLE' || body.error === 'DELIVERY_QUOTE_INVALID') {
          setQuoteNonce((n) => n + 1); // re-fetch fresh options
        }
        // Let the revalidation banner take over with per-item specifics
        // instead of a single flat line.
        if (body.error === 'PRODUCT_UNAVAILABLE' || body.error === 'INVALID_QUANTITY') {
          void runValidation();
          setError('Some items in your cart changed — see the note above and try again.');
        } else {
          setError((body.error && map[body.error]) ?? body.message ?? 'Something went wrong.');
        }
        setSubmitting(false);
        return;
      }

      // Card checkout redirects to Stripe's hosted page; Cash App/Zelle have
      // no external payment page to visit — the buyer pays via the QR/contact
      // info shown on the order's own tracking page (OrderStatusTracker),
      // which is also where they'll see the seller's manual confirmation land.
      // The cart is NOT cleared here — it must survive the trip to Stripe's
      // hosted page so a buyer who cancels can come back and retry. It's
      // cleared on the order success page instead (ClearStoreCart).
      if (paymentMethod === 'card') {
        if (!body.paymentUrl) {
          setError('Payment could not be started. Please try again.');
          setSubmitting(false);
          return;
        }
        window.location.href = body.paymentUrl;
        return;
      }

      router.push(`${linkBase}/orders/${body.trackingToken}/success`);
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
        <Link href={linkBase || '/'} className="text-sm font-semibold text-primary">
          Back to {storeName}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:py-12">
      <Link
        href={linkBase || '/'}
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

      {storePaused && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">{storeName} stopped taking orders.</p>
          <p className="mt-0.5 text-amber-800">
            {validation?.pauseMessage || 'Please check back soon.'}
          </p>
        </div>
      )}

      {(blockedLines.length > 0 || adjustedLines.length > 0) && (
        <div
          role="alert"
          className="mb-6 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <p className="font-semibold">Your cart changed since you added these items</p>
          <ul className="space-y-1.5">
            {[...blockedLines, ...adjustedLines].map((line) => (
              <li key={`${line.productId}:${line.variantId ?? ''}`} className="flex gap-2">
                <Icon i="alert-circle" size={15} className="mt-0.5 flex-shrink-0" />
                <span>{line.changes.map((c) => CHANGE_COPY[c](line.name, line)).join(' ')}</span>
              </li>
            ))}
          </ul>
          {blockedLines.length > 0 && (
            <button
              type="button"
              onClick={removeBlockedItems}
              className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-amber-50"
            >
              Remove unavailable {blockedLines.length === 1 ? 'item' : 'items'}
            </button>
          )}
          {validation?.hasPriceIncrease && (
            <label className="flex items-start gap-2 pt-1 text-xs">
              <input
                type="checkbox"
                checked={priceAck}
                onChange={(e) => setPriceAck(e.target.checked)}
                className="mt-0.5"
              />
              <span>I understand the updated prices and want to continue.</span>
            </label>
          )}
        </div>
      )}

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
              <OptionCard
                name="fulfillmentMethod"
                checked={fulfillmentMethod === 'delivery'}
                onSelect={() => setFulfillmentMethod('delivery')}
                icon="truck"
                tone="bg-primary"
                title="Delivery"
                subtitle={
                  freeDelivery
                    ? 'Free with your promo code'
                    : deliveryBlocked
                      ? 'Not available for this address'
                      : !addressComplete
                        ? 'Priced by address below'
                        : quoting
                          ? 'Getting a price…'
                          : selectedOption
                            ? `${selectedOption.feeCents > 0 ? formatUsd(selectedOption.feeCents) : 'Free'}${
                                etaLabel(selectedOption.estimatedDropoffAt)
                                  ? ` · ${etaLabel(selectedOption.estimatedDropoffAt)}`
                                  : ''
                              }`
                            : deliveryFeeCents > 0
                              ? formatUsd(deliveryFeeCents)
                              : 'Free'
                }
              />
              <OptionCard
                name="fulfillmentMethod"
                checked={fulfillmentMethod === 'pickup'}
                onSelect={() => setFulfillmentMethod('pickup')}
                icon="shopping-bag"
                tone="bg-accent"
                title="Pickup"
                subtitle={fulfillmentMethod === 'pickup' && pickupAddress ? pickupAddress : 'Free'}
              />
            </div>
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

                {deliveryBlocked && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    Delivery isn’t available for this address right now. Try a different address, or
                    choose <strong>Pickup</strong> above.
                  </div>
                )}

                {showProviderPicker && !deliveryBlocked && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Choose a courier</p>
                    {serviceableOptions.map((o) => (
                      <label
                        key={o.provider}
                        className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 text-sm ${
                          selectedProviderType === o.provider
                            ? 'border-primary bg-secondary'
                            : 'border-border'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="deliveryProvider"
                            checked={selectedProviderType === o.provider}
                            onChange={() => {
                              setSelectedProviderType(o.provider);
                              setSelectedQuoteId(o.quoteId);
                            }}
                          />
                          <span className="font-medium text-foreground">{o.friendlyName}</span>
                          {etaLabel(o.estimatedDropoffAt) && (
                            <span className="text-muted-foreground">
                              {etaLabel(o.estimatedDropoffAt)}
                            </span>
                          )}
                        </span>
                        <span className="font-semibold text-foreground">
                          {o.feeCents > 0 ? formatUsd(o.feeCents) : 'Free'}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <p className="mb-3 text-sm font-medium text-foreground">Payment Method</p>
            <div className="space-y-2">
              <OptionCard
                name="paymentMethod"
                checked={paymentMethod === 'card'}
                onSelect={() => setPaymentMethod('card')}
                icon="credit-card"
                tone="bg-primary"
                title="Card"
                subtitle="Visa, Mastercard, Amex"
              />
              {cashAppCashtag && (
                <OptionCard
                  name="paymentMethod"
                  checked={paymentMethod === 'cashapp'}
                  onSelect={() => setPaymentMethod('cashapp')}
                  icon="dollar-sign"
                  tone="bg-[#00d64f]"
                  title="Cash App"
                  subtitle={`$${cashAppCashtag}`}
                />
              )}
              {zelleContact && (
                <OptionCard
                  name="paymentMethod"
                  checked={paymentMethod === 'zelle'}
                  onSelect={() => setPaymentMethod('zelle')}
                  icon="smartphone"
                  tone="bg-[#6d1ed4]"
                  title="Zelle"
                  subtitle="Bank transfer"
                />
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

          <Button
            type="submit"
            variant="dark"
            disabled={submitting || quoting || checkoutBlocked || needsPriceAck}
            className="w-full py-3.5"
          >
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
  linkBase,
  storeName,
  cashAppCashtag = null,
  zelleContact = null,
  deliveryFeeCents = 0,
  deliveryProvider = 'self_manual',
  pickupAddress = null,
}: {
  storeSlug: string;
  linkBase?: string;
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
          linkBase={linkBase ?? `/s/${storeSlug}`}
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
