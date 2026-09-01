'use client';

import { sellerFirstName } from '@/lib/utils';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { WithdrawalRequestForm } from '@/components/seller/WithdrawalRequestForm';

interface WithdrawalItem {
  id: string;
  amount: number;
  // Phase 1b — Cash App / Zelle commission withheld from this payout. The
  // merchant received `amount - commissionSettledCents`.
  commissionSettledCents?: number;
  currency: string;
  status: string;
  destination: { method?: string; cashtag?: string; contact?: string };
  requestedAt: string;
  completedAt: string | null;
}

interface StripeStatus {
  stripeOnboardingStatus: 'NOT_STARTED' | 'PENDING' | 'ACTIVE' | 'RESTRICTED';
  connected: boolean;
}

interface BillingStatus {
  plan: 'FREE' | 'PRO';
  planSource: 'SUBSCRIPTION' | 'COMP' | null;
  subscriptionStatus: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | null;
  currentPeriodEnd: string | null;
  compExpiresAt: string | null;
  hasBillingCustomer: boolean;
  billingConfigured: boolean;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function destinationLabel(d: WithdrawalItem['destination']): string {
  if (d.method === 'CASH_APP') return `Cash App ${d.cashtag ?? ''}`.trim();
  if (d.method === 'ZELLE') return `Zelle ${d.contact ?? ''}`.trim();
  return d.method ?? 'Unknown method';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function planSummary(b: BillingStatus): string {
  if (b.plan !== 'PRO') {
    return b.billingConfigured
      ? 'Upgrade to Pro for a 1.5% card fee, courier delivery, promo codes, analytics and more.'
      : 'You’re on the Free plan.';
  }
  if (b.planSource === 'COMP') {
    return b.compExpiresAt
      ? `Pro is on the house until ${formatDate(b.compExpiresAt)}.`
      : 'Pro is on the house.';
  }
  if (b.subscriptionStatus === 'PAST_DUE') {
    return 'Your last payment failed — update your card to keep Pro. Manage billing below.';
  }
  if (b.subscriptionStatus === 'CANCELED') {
    return b.currentPeriodEnd
      ? `Pro ends ${formatDate(b.currentPeriodEnd)}. Resubscribe anytime.`
      : 'Your Pro plan has been cancelled.';
  }
  return b.currentPeriodEnd
    ? `Pro renews ${formatDate(b.currentPeriodEnd)}. Thanks for supporting Vendylio.`
    : 'You’re on Pro — thanks for supporting Vendylio.';
}

export default function BillingPayoutsPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [items, setItems] = useState<WithdrawalItem[] | null>(null);
  const [availableCents, setAvailableCents] = useState<number | null>(null);
  const [commissionOwedCents, setCommissionOwedCents] = useState(0);
  const [stripe, setStripe] = useState<StripeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const loadWithdrawals = useCallback(() => {
    api<{
      items: WithdrawalItem[];
      availableCents: number | null;
      commissionOwedCents?: number;
    }>('/api/withdrawals')
      .then((res) => {
        setItems(res.items);
        setAvailableCents(res.availableCents);
        setCommissionOwedCents(res.commissionOwedCents ?? 0);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load withdrawal history.');
      });
  }, []);

  const loadPlan = useCallback(() => {
    api<BillingStatus>('/api/billing/status')
      .then(setBilling)
      .catch(() => {
        // Non-critical for this page — the withdrawal history is the primary
        // content, so a failed plan lookup just hides the plan card.
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    loadWithdrawals();
    loadPlan();
    api<StripeStatus>('/api/stores/stripe/status')
      .then(setStripe)
      .catch(() => {
        /* non-critical — the card just hides */
      });
  }, [user, loadWithdrawals, loadPlan]);

  async function onUpgrade() {
    setPlanError(null);
    setPlanBusy(true);
    try {
      const res = await api<{ url: string }>('/api/billing/checkout', { method: 'POST' });
      window.location.href = res.url;
    } catch (err) {
      setPlanError(
        err instanceof ApiError
          ? err.code === 'BILLING_NOT_CONFIGURED'
            ? 'Subscription billing isn’t available yet — check back soon.'
            : err.message
          : 'Network error. Try again.',
      );
      setPlanBusy(false);
    }
  }

  async function onManageBilling() {
    setPlanError(null);
    setPlanBusy(true);
    try {
      const res = await api<{ url: string }>('/api/billing/portal', { method: 'POST' });
      window.location.href = res.url;
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : 'Network error. Try again.');
      setPlanBusy(false);
    }
  }

  if (!user) return null;

  const totalWithdrawnCents = (items ?? [])
    .filter((w) => w.status === 'COMPLETED')
    .reduce((sum, w) => sum + w.amount, 0);
  const pendingCents = (items ?? [])
    .filter((w) => w.status === 'PENDING' || w.status === 'PROCESSING')
    .reduce((sum, w) => sum + w.amount, 0);

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
        <div className="mx-auto max-w-5xl">
          <div className="mb-12">
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
              Billing & Payouts
            </h1>
            <p className="text-base text-muted-foreground">
              Request withdrawals and track your payout history.
            </p>
          </div>

          {/* PAY-01 — how the money actually flows, in plain language. */}
          <Card className="mb-8 p-6">
            <h2 className="mb-3 font-headings text-base font-bold text-foreground">
              How you get paid
            </h2>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Icon i="credit-card" size={16} className="mt-0.5 flex-shrink-0 text-primary" />
                <span>
                  <strong className="text-foreground">Card payments</strong>{' '}
                  {stripe?.stripeOnboardingStatus === 'ACTIVE' ? (
                    <>
                      go straight to your connected Stripe account and are paid out to your bank on
                      Stripe&apos;s standard schedule. Vendylio&apos;s commission is deducted
                      automatically at the time of sale.
                    </>
                  ) : (
                    <>
                      are held by Vendylio until you request a withdrawal below. Connect Stripe in{' '}
                      <Link href="/onboarding/payments" className="font-medium text-primary">
                        payment settings
                      </Link>{' '}
                      to get paid automatically instead.
                    </>
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <Icon i="smartphone" size={16} className="mt-0.5 flex-shrink-0 text-primary" />
                <span>
                  <strong className="text-foreground">Cash App &amp; Zelle payments</strong> go
                  directly to you — you confirm receipt yourself on the order. Vendylio&apos;s
                  marketplace commission on those orders is then{' '}
                  <strong className="text-foreground">withheld from your next withdrawal</strong>{' '}
                  (or, if you have no balance to withhold from, billed to the card on file).
                </span>
              </li>
              <li className="flex gap-2">
                <Icon i="clock" size={16} className="mt-0.5 flex-shrink-0 text-primary" />
                <span>
                  Manual withdrawals (the balance below) are reviewed and paid out by the Vendylio
                  team. There are no withdrawal fees.
                </span>
              </li>
            </ul>
          </Card>

          <div className="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Card>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Available to Withdraw
              </p>
              <p className="font-headings text-3xl font-bold text-foreground">
                {availableCents === null ? '—' : formatUsd(availableCents)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Card sales held by Vendylio, net of commission
                {stripe?.stripeOnboardingStatus === 'ACTIVE'
                  ? ' (from before you connected Stripe).'
                  : '.'}
              </p>
            </Card>
            <Card>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Pending</p>
              <p className="font-headings text-3xl font-bold text-foreground">
                {formatUsd(pendingCents)}
              </p>
              {commissionOwedCents > 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  {formatUsd(commissionOwedCents)} Vendylio commission due — settled from your next
                  withdrawal.
                </p>
              )}
              {commissionOwedCents < 0 && (
                <p className="mt-2 text-xs text-green-700">
                  {formatUsd(-commissionOwedCents)} commission credit — applied to your next
                  withdrawal.
                </p>
              )}
            </Card>
            <Card>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Total Withdrawn
              </p>
              <p className="font-headings text-3xl font-bold text-foreground">
                {formatUsd(totalWithdrawnCents)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">0% fees</p>
            </Card>
          </div>

          {billing && (
            <Card className="mb-12 flex flex-col items-start justify-between gap-4 p-8 sm:flex-row sm:items-center">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Your Plan
                </p>
                <p className="font-headings text-2xl font-bold text-foreground">
                  {billing.plan === 'PRO' ? 'Pro' : 'Free'}
                  {billing.plan === 'PRO' && billing.subscriptionStatus === 'PAST_DUE' && (
                    <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      Payment due
                    </span>
                  )}
                </p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  {planSummary(billing)}
                </p>
                {planError && <p className="mt-2 text-sm text-red-600">{planError}</p>}
              </div>
              <div className="flex flex-shrink-0 flex-col items-stretch gap-2 sm:items-end">
                {billing.plan !== 'PRO' && billing.billingConfigured && (
                  <button
                    type="button"
                    onClick={onUpgrade}
                    disabled={planBusy}
                    className="rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {planBusy ? 'Opening…' : 'Upgrade to Pro'}
                  </button>
                )}
                {billing.hasBillingCustomer && billing.planSource === 'SUBSCRIPTION' && (
                  <button
                    type="button"
                    onClick={onManageBilling}
                    disabled={planBusy}
                    className="rounded-lg border border-border px-6 py-3 text-sm font-semibold text-foreground disabled:opacity-50"
                  >
                    {planBusy ? 'Opening…' : 'Manage billing'}
                  </button>
                )}
                <a
                  href="/pricing"
                  target="_blank"
                  rel="noreferrer"
                  className="text-center text-xs font-medium text-primary sm:text-right"
                >
                  Compare plans
                </a>
              </div>
            </Card>
          )}

          <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Card className="p-8">
              <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
                Request a Withdrawal
              </h2>
              <WithdrawalRequestForm
                onRequested={loadWithdrawals}
                commissionOwedCents={commissionOwedCents}
              />
            </Card>

            <Card className="p-8">
              <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
                Payout Methods
              </h2>
              <p className="text-sm text-muted-foreground">
                Vendylio doesn&apos;t save payment methods — enter your Cash App tag or Zelle
                contact each time you request a withdrawal. Withdrawals are fulfilled manually by
                the Vendylio team; there are no automated payout fees.
              </p>
            </Card>
          </div>

          <Card className="p-8">
            <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
              Withdrawal History
            </h2>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!error && items === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!error && items !== null && items.length === 0 && (
              <div className="py-8 text-center">
                <Icon
                  i="inbox"
                  size={28}
                  className="mx-auto mb-3 text-muted-foreground opacity-50"
                />
                <p className="text-sm text-muted-foreground">No withdrawals yet.</p>
              </div>
            )}
            {items && items.length > 0 && (
              <div className="space-y-2">
                {items.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between rounded-lg border border-border p-4"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {destinationLabel(w.destination)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(w.requestedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-base font-bold text-foreground">
                        {formatUsd(w.amount - (w.commissionSettledCents ?? 0))}
                      </p>
                      {(w.commissionSettledCents ?? 0) !== 0 && (
                        <p className="text-xs text-muted-foreground">
                          {formatUsd(w.amount)} gross − {formatUsd(w.commissionSettledCents ?? 0)}{' '}
                          commission
                        </p>
                      )}
                    </div>
                    <span
                      className={`ml-4 inline-block rounded px-3 py-1 text-xs font-semibold ${
                        w.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-700'
                          : w.status === 'FAILED' || w.status === 'CANCELLED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {w.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
