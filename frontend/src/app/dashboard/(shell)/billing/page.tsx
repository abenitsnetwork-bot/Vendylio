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
  currency: string;
  status: string;
  destination: { method?: string; cashtag?: string; contact?: string };
  requestedAt: string;
  completedAt: string | null;
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function destinationLabel(d: WithdrawalItem['destination']): string {
  if (d.method === 'CASH_APP') return `Cash App ${d.cashtag ?? ''}`.trim();
  if (d.method === 'ZELLE') return `Zelle ${d.contact ?? ''}`.trim();
  return d.method ?? 'Unknown method';
}

export default function BillingPayoutsPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [items, setItems] = useState<WithdrawalItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const loadWithdrawals = useCallback(() => {
    api<{ items: WithdrawalItem[] }>('/api/withdrawals')
      .then((res) => setItems(res.items))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load withdrawal history.');
      });
  }, []);

  const loadPlan = useCallback(() => {
    api<{ store: { plan: string } }>('/api/stores/me')
      .then((res) => setPlan(res.store.plan))
      .catch(() => {
        // Non-critical for this page — the withdrawal history above is the
        // primary content, so a failed plan lookup just hides the card.
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    loadWithdrawals();
    loadPlan();
  }, [user, loadWithdrawals, loadPlan]);

  async function onUpgrade() {
    setPlanError(null);
    setUpgrading(true);
    try {
      const res = await api<{ store: { plan: string } }>('/api/stores/upgrade', {
        method: 'POST',
      });
      setPlan(res.store.plan);
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : 'Network error. Try again.');
    } finally {
      setUpgrading(false);
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

          <div className="mb-12 grid grid-cols-1 gap-6 sm:grid-cols-3">
            <Card>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Available to Withdraw
              </p>
              <p className="font-headings text-3xl font-bold text-foreground">$0.00</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Balance tracking isn&apos;t linked to store sales yet in this build.
              </p>
            </Card>
            <Card>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Pending</p>
              <p className="font-headings text-3xl font-bold text-foreground">
                {formatUsd(pendingCents)}
              </p>
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

          {plan && (
            <Card className="mb-12 flex flex-col items-start justify-between gap-4 p-8 sm:flex-row sm:items-center">
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Your Plan
                </p>
                <p className="font-headings text-2xl font-bold text-foreground">
                  {plan === 'PRO' ? 'Pro' : 'Free'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan === 'PRO'
                    ? "You're on Pro — thanks for supporting Vendylio."
                    : 'Upgrade to Pro for a reduced marketplace commission.'}
                </p>
                {planError && <p className="mt-2 text-sm text-red-600">{planError}</p>}
              </div>
              {plan !== 'PRO' && (
                <button
                  type="button"
                  onClick={onUpgrade}
                  disabled={upgrading}
                  className="flex-shrink-0 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {upgrading ? 'Upgrading…' : 'Upgrade to Pro'}
                </button>
              )}
            </Card>
          )}

          <div className="mb-12 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <Card className="p-8">
              <h2 className="mb-6 border-b border-border pb-6 font-headings text-lg font-bold text-foreground">
                Request a Withdrawal
              </h2>
              <WithdrawalRequestForm onRequested={loadWithdrawals} />
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
                    <p className="text-base font-bold text-foreground">{formatUsd(w.amount)}</p>
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
