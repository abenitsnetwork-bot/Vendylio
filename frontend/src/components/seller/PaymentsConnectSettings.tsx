'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';

interface StripeStatus {
  stripeOnboardingStatus: 'NOT_STARTED' | 'PENDING' | 'ACTIVE' | 'RESTRICTED';
  connected: boolean;
}

const STATUS_COPY: Record<StripeStatus['stripeOnboardingStatus'], { title: string; body: string }> =
  {
    NOT_STARTED: {
      title: 'Not connected',
      body: 'Connect Stripe so payments go straight to your bank account instead of needing a manual withdrawal.',
    },
    PENDING: {
      title: 'Onboarding in progress',
      body: 'Stripe is still waiting on a few details. Continue where you left off.',
    },
    ACTIVE: {
      title: 'Connected',
      body: 'Sales route directly to your Stripe account. No manual withdrawal needed for these.',
    },
    RESTRICTED: {
      title: 'Action needed',
      body: 'Stripe has restricted this account — usually a missing document or detail. Continue onboarding to fix it.',
    },
  };

/**
 * Wires the Phase 3 Stripe Connect backend (POST /api/stores/stripe/onboard,
 * GET /api/stores/stripe/status) to a UI for the first time — those routes
 * shipped with no frontend of their own back in Phase 3.
 */
export function PaymentsConnectSettings() {
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    api<StripeStatus>('/api/stores/stripe/status')
      .then(setStatus)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load status.'));
  }, []);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await api<{ url: string }>('/api/stores/stripe/onboard', { method: 'POST' });
      window.location.href = res.url;
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === 'PAYMENT_PROVIDER_UNCONFIGURED'
          ? 'Stripe is not configured for this store yet.'
          : err instanceof ApiError
            ? err.message
            : 'Could not start Stripe onboarding.';
      setError(message);
      setConnecting(false);
    }
  }

  return (
    <Card className="p-5 sm:p-8">
      <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
        Stripe Connect
      </h2>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!error && !status && <p className="text-sm text-muted-foreground">Loading…</p>}

      {status && (
        <>
          <div className="mb-6 flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                status.stripeOnboardingStatus === 'ACTIVE'
                  ? 'bg-panel text-panel-foreground'
                  : status.stripeOnboardingStatus === 'RESTRICTED'
                    ? 'bg-red-100 text-red-600'
                    : 'bg-secondary text-muted-foreground'
              }`}
            >
              <Icon
                i={status.stripeOnboardingStatus === 'ACTIVE' ? 'check' : 'credit-card'}
                size={16}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {STATUS_COPY[status.stripeOnboardingStatus].title}
              </p>
              <p className="text-sm text-muted-foreground">
                {STATUS_COPY[status.stripeOnboardingStatus].body}
              </p>
            </div>
          </div>

          {status.stripeOnboardingStatus !== 'ACTIVE' && (
            <button
              type="button"
              onClick={onConnect}
              disabled={connecting}
              className="rounded-lg border border-border bg-secondary px-5 py-2.5 text-sm font-semibold text-foreground disabled:opacity-50"
            >
              {connecting
                ? 'Redirecting…'
                : status.connected
                  ? 'Continue onboarding'
                  : 'Connect with Stripe'}
            </button>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Skipping this is fine — your store still sells without it, you just withdraw manually
            from Billing & Payouts instead.
          </p>
        </>
      )}
    </Card>
  );
}
