'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { handleGateError } from '@/lib/upgradePrompt';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { formatUsd, type SellerOrder } from '@/components/seller/OrdersTable';
import { formatOrderNumber } from '@/lib/orderNumber';

type ConfigState = 'CONFIGURED' | 'ENABLED' | 'DISABLED' | 'UNAVAILABLE';

interface FulfillmentConfig {
  pickup: { enabled: boolean; instructions: string | null };
  merchant: {
    enabled: boolean;
    feeCents: number;
    minOrderCents: number;
    instructions: string | null;
  };
  uberDirect: { enabled: boolean };
  doordash: { enabled: boolean };
  customerChoosesProvider: boolean;
}

interface SettingsResponse {
  config: FulfillmentConfig;
  providerStates: Record<string, ConfigState>;
  warnings?: { provider: string; message: string }[];
}

const STATE_BADGE: Record<ConfigState, { label: string; cls: string }> = {
  ENABLED: { label: 'Connected', cls: 'bg-green-100 text-green-700' },
  CONFIGURED: { label: 'Ready', cls: 'bg-secondary text-muted-foreground' },
  DISABLED: { label: 'Off', cls: 'bg-secondary text-muted-foreground' },
  // UNAVAILABLE = the provider's PLATFORM credentials aren't set (Vendylio-side,
  // not the merchant's problem to fix). "Unavailable" is more honest than a
  // "needs setup" that implies merchant action.
  UNAVAILABLE: { label: 'Unavailable', cls: 'bg-amber-100 text-amber-800' },
};

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
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">
          {formatOrderNumber(order.orderNumber)}
        </p>
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

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
        on ? 'bg-primary' : 'bg-border'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          on ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function DeliveryPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [cfg, setCfg] = useState<FulfillmentConfig | null>(null);
  const [merchantFee, setMerchantFee] = useState('');
  const [merchantMin, setMerchantMin] = useState('');
  const [needsDelivery, setNeedsDelivery] = useState<SellerOrder[] | null>(null);
  const [outForDelivery, setOutForDelivery] = useState<SellerOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{
    provider: string;
    ok: boolean;
    detail: string;
  } | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api<SettingsResponse>('/api/stores/fulfillment'),
      api<{ items: SellerOrder[] }>('/api/orders?status=READY'),
      api<{ items: SellerOrder[] }>('/api/orders?status=OUT_FOR_DELIVERY'),
    ])
      .then(([s, readyRes, outRes]) => {
        setSettings(s);
        setCfg(s.config);
        setMerchantFee((s.config.merchant.feeCents / 100).toFixed(2));
        setMerchantMin((s.config.merchant.minOrderCents / 100).toFixed(2));
        setNeedsDelivery(readyRes.items.filter((o) => o.fulfillmentMethod !== 'PICKUP'));
        setOutForDelivery(outRes.items.filter((o) => o.fulfillmentMethod !== 'PICKUP'));
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load delivery settings.'),
      );
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    const feeCents = Math.round(Number(merchantFee) * 100);
    const minOrderCents = Math.round(Number(merchantMin) * 100);
    if (
      !Number.isFinite(feeCents) ||
      feeCents < 0 ||
      !Number.isFinite(minOrderCents) ||
      minOrderCents < 0
    ) {
      setError('Enter valid amounts for the merchant-delivery fee and minimum.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await api<SettingsResponse>('/api/stores/fulfillment', {
        method: 'PATCH',
        body: {
          pickup: { enabled: cfg.pickup.enabled, instructions: cfg.pickup.instructions },
          merchant: {
            enabled: cfg.merchant.enabled,
            feeCents,
            minOrderCents,
            instructions: cfg.merchant.instructions,
          },
          uberDirect: { enabled: cfg.uberDirect.enabled },
          doordash: { enabled: cfg.doordash.enabled },
          customerChoosesProvider: cfg.customerChoosesProvider,
        },
      });
      setSettings(res);
      setCfg(res.config);
    } catch (err) {
      if (!handleGateError(err)) {
        setError(err instanceof ApiError ? err.message : 'Could not save.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(provider: 'UBER_DIRECT' | 'DOORDASH') {
    setTestResult(null);
    try {
      const r = await api<{ ok: boolean; detail: string }>(
        '/api/stores/fulfillment/test-connection',
        {
          method: 'POST',
          body: { provider },
        },
      );
      setTestResult({ provider, ...r });
    } catch (err) {
      setTestResult({
        provider,
        ok: false,
        detail: err instanceof ApiError ? err.message : 'Test failed.',
      });
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
  const states = settings?.providerStates ?? {};

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
            Delivery &amp; Fulfillment
          </h1>
          <p className="mb-10 text-base text-muted-foreground">
            Choose how customers get their orders. Turn methods on and off — only connected,
            serviceable methods appear at checkout.
          </p>

          {error && <p className="mb-6 text-sm text-red-600">{error}</p>}

          {cfg && (
            <Card className="mb-8 p-8">
              <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
                Delivery methods
              </h2>
              <form onSubmit={save} className="space-y-5">
                {/* Uber Direct */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Uber Direct{' '}
                      {states.UBER_DIRECT && (
                        <span
                          className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATE_BADGE[states.UBER_DIRECT].cls}`}
                        >
                          {STATE_BADGE[states.UBER_DIRECT].label}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      On-demand courier network.{' '}
                      <button
                        type="button"
                        onClick={() => testConnection('UBER_DIRECT')}
                        className="font-medium text-primary underline"
                      >
                        Test connection
                      </button>
                    </p>
                  </div>
                  <Toggle
                    on={cfg.uberDirect.enabled}
                    onChange={(v) => setCfg({ ...cfg, uberDirect: { enabled: v } })}
                  />
                </div>

                {/* DoorDash */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      DoorDash{' '}
                      {states.DOORDASH && (
                        <span
                          className={`ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATE_BADGE[states.DOORDASH].cls}`}
                        >
                          {STATE_BADGE[states.DOORDASH].label}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      DoorDash Drive courier network.{' '}
                      <button
                        type="button"
                        onClick={() => testConnection('DOORDASH')}
                        className="font-medium text-primary underline"
                      >
                        Test connection
                      </button>
                    </p>
                  </div>
                  <Toggle
                    on={cfg.doordash.enabled}
                    onChange={(v) => setCfg({ ...cfg, doordash: { enabled: v } })}
                  />
                </div>

                {testResult && (
                  <p
                    className={`rounded-lg p-3 text-xs ${
                      testResult.ok ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'
                    }`}
                  >
                    {testResult.provider}: {testResult.detail}
                  </p>
                )}

                {/* Merchant delivery */}
                <div className="border-t border-border pt-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Merchant delivery</p>
                      <p className="text-xs text-muted-foreground">You deliver orders yourself.</p>
                    </div>
                    <Toggle
                      on={cfg.merchant.enabled}
                      onChange={(v) =>
                        setCfg({ ...cfg, merchant: { ...cfg.merchant, enabled: v } })
                      }
                    />
                  </div>
                  {cfg.merchant.enabled && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Field label="Delivery fee ($)" htmlFor="mFee">
                        <input
                          id="mFee"
                          type="number"
                          min="0"
                          step="0.01"
                          className={inputClass}
                          value={merchantFee}
                          onChange={(e) => setMerchantFee(e.target.value)}
                        />
                      </Field>
                      <Field label="Minimum order ($, 0 = none)" htmlFor="mMin">
                        <input
                          id="mMin"
                          type="number"
                          min="0"
                          step="0.01"
                          className={inputClass}
                          value={merchantMin}
                          onChange={(e) => setMerchantMin(e.target.value)}
                        />
                      </Field>
                      <Field label="Delivery instructions (optional)" htmlFor="mInstr">
                        <input
                          id="mInstr"
                          type="text"
                          className={inputClass}
                          value={cfg.merchant.instructions ?? ''}
                          onChange={(e) =>
                            setCfg({
                              ...cfg,
                              merchant: { ...cfg.merchant, instructions: e.target.value || null },
                            })
                          }
                        />
                      </Field>
                    </div>
                  )}
                </div>

                {/* Pickup */}
                <div className="border-t border-border pt-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Customer pickup</p>
                      <p className="text-xs text-muted-foreground">
                        Buyers collect in person at your store address.
                      </p>
                    </div>
                    <Toggle
                      on={cfg.pickup.enabled}
                      onChange={(v) => setCfg({ ...cfg, pickup: { ...cfg.pickup, enabled: v } })}
                    />
                  </div>
                  {cfg.pickup.enabled && (
                    <Field label="Pickup instructions (optional)" htmlFor="pInstr">
                      <input
                        id="pInstr"
                        type="text"
                        className={inputClass}
                        value={cfg.pickup.instructions ?? ''}
                        onChange={(e) =>
                          setCfg({
                            ...cfg,
                            pickup: { ...cfg.pickup, instructions: e.target.value || null },
                          })
                        }
                      />
                    </Field>
                  )}
                </div>

                {/* Customer choice */}
                <label className="flex items-center gap-3 border-t border-border pt-5 text-sm">
                  <input
                    type="checkbox"
                    checked={cfg.customerChoosesProvider}
                    onChange={(e) => setCfg({ ...cfg, customerChoosesProvider: e.target.checked })}
                  />
                  <span className="text-foreground">
                    Let customers choose their courier when more than one is available
                    <span className="block text-xs text-muted-foreground">
                      Off = the cheapest serviceable option is used automatically.
                    </span>
                  </span>
                </label>

                <Button type="submit" disabled={saving} className="mt-2">
                  {saving ? 'Saving…' : 'Save settings'}
                </Button>
                {settings?.warnings?.map((w) => (
                  <p key={w.provider} className="text-xs text-amber-700">
                    ⚠️ {w.message}
                  </p>
                ))}
              </form>
            </Card>
          )}

          <Card className="mb-8 p-8">
            <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
              Needs delivery
            </h2>
            {needsDelivery === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {needsDelivery?.length === 0 && (
              <p className="text-sm text-muted-foreground">No orders ready for delivery.</p>
            )}
            <div className="space-y-2">
              {needsDelivery?.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  actionLabel="Request delivery"
                  onAction={() => requestDelivery(order.id)}
                  busy={busyOrderId === order.id}
                />
              ))}
            </div>
          </Card>

          <Card className="p-8">
            <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
              Out for delivery
            </h2>
            {outForDelivery === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {outForDelivery?.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing out for delivery right now.</p>
            )}
            <div className="space-y-2">
              {outForDelivery?.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  actionLabel="Mark delivered"
                  onAction={() => markDelivered(order.id)}
                  busy={busyOrderId === order.id}
                />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
