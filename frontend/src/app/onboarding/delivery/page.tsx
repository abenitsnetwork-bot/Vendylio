'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useOnboarding } from '../layout';

export default function DeliveryStepPage() {
  const { store, refresh } = useOnboarding();
  const router = useRouter();

  const [provider, setProvider] = useState(store?.deliveryProvider ?? 'self_manual');
  const [pickupAddress, setPickupAddress] = useState(store?.pickupAddress ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setWarning(null);
    if (provider === 'uber_direct' && !pickupAddress.trim()) {
      setError('Set a pickup address before switching to Uber Direct.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ deliverabilityWarning?: string }>('/api/stores', {
        method: 'PATCH',
        body: {
          deliveryProvider: provider,
          pickupAddress: pickupAddress.trim() || null,
        },
      });
      if (res.deliverabilityWarning) setWarning(res.deliverabilityWarning);
      refresh();
      router.push('/onboarding/preview');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-2xl">
      <div className="mb-8">
        <h1
          className="mb-2 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
        >
          Set up delivery
        </h1>
        <p className="text-sm text-muted-foreground">
          You deliver your own orders by default — no setup needed. Vendylio can also arrange local
          courier delivery through Uber Direct.
        </p>
      </div>

      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setProvider('self_manual')}
          className={`flex w-full items-center justify-between rounded-lg border p-4 text-left ${
            provider === 'self_manual' ? 'border-primary bg-secondary' : 'border-border'
          }`}
        >
          <div>
            <p className="text-sm font-semibold text-foreground">I&apos;ll deliver it myself</p>
            <p className="text-xs text-muted-foreground">
              No setup required — you handle drop-off or the customer picks up.
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setProvider('uber_direct')}
          className={`flex w-full items-center justify-between rounded-lg border p-4 text-left ${
            provider === 'uber_direct' ? 'border-primary bg-secondary' : 'border-border'
          }`}
        >
          <div>
            <p className="text-sm font-semibold text-foreground">Local courier delivery</p>
            <p className="text-xs text-muted-foreground">
              A real courier picks up and delivers your orders through Uber Direct.
            </p>
          </div>
        </button>

        {provider === 'uber_direct' && (
          <Field label="Pickup Address" htmlFor="pickupAddress">
            <input
              id="pickupAddress"
              className={inputClass}
              placeholder="123 Main St, Springfield, IL 62704"
              value={pickupAddress}
              onChange={(e) => setPickupAddress(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Where the courier picks up your orders from.
            </p>
          </Field>
        )}

        {warning && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            ⚠️ {warning}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="pt-2">
          <Button type="submit" disabled={submitting} className="sm:px-10">
            {submitting ? 'Saving…' : 'Save & Continue'}
          </Button>
        </div>
      </div>
    </form>
  );
}
