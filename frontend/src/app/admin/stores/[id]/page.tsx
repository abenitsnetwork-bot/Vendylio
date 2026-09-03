'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAdminAuth } from '@/contexts/AdminContext';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';

interface TeamMember {
  id: string;
  email: string;
  name: string | null;
  appRole: string;
  status: string;
  emailVerified: boolean;
  orgRole: string;
  isOwner: boolean;
}

interface StoreDetail {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  publishedAt: string | null;
  ordersPaused: boolean;
  plan: string;
  planSource: string | null;
  subscriptionStatus: string | null;
  planCompExpiresAt: string | null;
  createdAt: string;
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  productCount: number;
  orderCount: number;
}

function planSourceLabel(s: StoreDetail): string {
  if (s.planSource === 'SUBSCRIPTION') {
    return `Paid via Stripe${s.subscriptionStatus ? ` · ${s.subscriptionStatus}` : ''}`;
  }
  if (s.planSource === 'COMP') {
    return s.planCompExpiresAt
      ? `Comped until ${new Date(s.planCompExpiresAt).toLocaleDateString()}`
      : 'Comped';
  }
  return s.plan === 'PRO' ? 'Manual — no billing attached' : 'Default';
}

export default function AdminStoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, admin } = useAdminAuth();
  const canResetPassword = can.includes('users:password-reset');
  const isSuperadmin = admin?.role === 'SUPERADMIN';
  const [compDays, setCompDays] = useState('90');

  const [store, setStore] = useState<StoreDetail | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // userId -> the one-time password we just minted for them
  const [issued, setIssued] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setError(null);
    api<{ store: StoreDetail; team: TeamMember[] }>(`/api/admin/stores/${id}`)
      .then((res) => {
        setStore(res.store);
        setTeam(res.team);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError && err.code === 'STORE_NOT_FOUND'
            ? 'This store no longer exists.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load this store.',
        );
      });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePublished() {
    if (!store) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await api<{ store: { id: string; published: boolean } }>(
        `/api/admin/stores/${store.id}`,
        { method: 'PATCH', body: { published: !store.published } },
      );
      setStore((prev) => (prev ? { ...prev, published: res.store.published } : prev));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not update this store.');
    } finally {
      setBusy(false);
    }
  }

  async function setPlan(plan: 'FREE' | 'PRO') {
    if (!store) return;
    const body: { plan: 'FREE' | 'PRO'; compDays?: number } = { plan };
    if (plan === 'PRO') {
      const n = Number(compDays);
      if (!Number.isInteger(n) || n < 1 || n > 730) {
        setActionError('Comp length must be between 1 and 730 days.');
        return;
      }
      body.compDays = n;
    }
    if (
      plan === 'FREE' &&
      !confirm(`Move ${store.name} back to the Free plan? Any comped Pro is cleared.`)
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/admin/stores/${store.id}/plan`, { method: 'PATCH', body });
      load();
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.code === 'STRIPE_MANAGED_PLAN'
            ? 'This store pays for Pro via Stripe — cancel it through the subscription, not here.'
            : err.message
          : 'Could not change the plan.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(member: TeamMember) {
    if (
      !confirm(
        `Issue a one-time temporary password for ${member.email}? Their current password and all active sessions will stop working immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await api<{ tempPassword: string; email: string }>(
        `/api/admin/users/${member.id}/temp-password`,
        { method: 'POST' },
      );
      setIssued((prev) => ({ ...prev, [member.id]: res.tempPassword }));
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not reset this password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/admin/stores"
          className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
        >
          <Icon i="arrow-left" size={16} />
          Back to Stores
        </Link>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && !store && <p className="text-sm text-muted-foreground">Loading…</p>}

        {store && (
          <>
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1
                  className="mb-1 font-headings font-bold text-foreground"
                  style={{ fontSize: 'clamp(22px, 4vw, 28px)' }}
                >
                  {store.name}
                </h1>
                <a
                  href={`/s/${store.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-muted-foreground hover:text-accent"
                >
                  /s/{store.slug}
                </a>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  store.published ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
              >
                {store.published ? 'Active' : 'Inactive'}
              </span>
            </div>

            {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

            <Card className="mb-6">
              <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Plan</p>
                  <p className="font-semibold text-foreground">{store.plan}</p>
                  <p className="text-[11px] text-muted-foreground">{planSourceLabel(store)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Products</p>
                  <p className="font-semibold text-foreground">{store.productCount}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Orders</p>
                  <Link
                    href={`/admin/orders?storeId=${store.id}`}
                    className="font-semibold text-accent hover:underline"
                  >
                    {store.orderCount} →
                  </Link>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Created</p>
                  <p className="font-semibold text-foreground">
                    {new Date(store.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Terms accepted
                  </p>
                  <p className="font-semibold text-foreground">
                    {store.termsAcceptedAt
                      ? new Date(store.termsAcceptedAt).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
              </div>
              {store.ordersPaused && (
                <p className="mt-4 text-xs text-amber-700">
                  The seller has paused new orders (storefront still visible).
                </p>
              )}
            </Card>

            <Card className="mb-6">
              <p className="mb-1 text-sm font-semibold text-foreground">Store status</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Deactivating takes the storefront offline immediately — <code>/s/{store.slug}</code>{' '}
                returns 404 and checkout is refused. The seller&apos;s data is untouched.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={togglePublished}
                className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                  store.published
                    ? 'border-red-200 text-red-600 hover:bg-red-50'
                    : 'border-accent text-accent hover:bg-secondary'
                }`}
              >
                {busy ? 'Saving…' : store.published ? 'Deactivate store' : 'Activate store'}
              </button>
            </Card>

            {isSuperadmin && (
              <Card className="mb-6">
                <p className="mb-1 text-sm font-semibold text-foreground">Plan</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  {store.plan} · {planSourceLabel(store)}
                </p>

                {store.planSource === 'SUBSCRIPTION' ? (
                  <p className="rounded-lg border border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                    This store pays for Pro through Stripe. Change it through the subscription
                    (Stripe portal / dashboard) — the back office won&apos;t override a paid plan.
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    {store.plan !== 'FREE' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPlan('FREE')}
                        className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {busy ? 'Saving…' : 'Move to Free'}
                      </button>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPlan('PRO')}
                        className="rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-semibold text-foreground hover:bg-border disabled:opacity-50"
                      >
                        {store.plan === 'PRO' ? 'Re-comp Pro' : 'Comp Pro'}
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="730"
                        value={compDays}
                        onChange={(e) => setCompDays(e.target.value)}
                        aria-label="Comp length in days"
                        className="w-20 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground"
                      />
                      <span className="text-xs text-muted-foreground">days</span>
                    </div>
                  </div>
                )}
              </Card>
            )}

            <Card>
              <p className="mb-3 text-sm font-semibold text-foreground">Team</p>
              <ul className="divide-y divide-border">
                {team.map((m) => (
                  <li key={m.id} className="flex flex-col gap-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/admin/users/${m.id}`}
                            className="text-sm font-semibold text-foreground hover:text-accent"
                          >
                            {m.name ?? m.email}
                          </Link>
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-accent">
                            {m.isOwner ? 'Owner' : m.orgRole}
                          </span>
                          {m.appRole !== 'USER' && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                              {m.appRole}
                            </span>
                          )}
                          {m.status === 'SUSPENDED' && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              Suspended
                            </span>
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.email}
                          {!m.emailVerified && ' · email not verified'}
                        </p>
                      </div>
                      {canResetPassword && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => resetPassword(m)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
                        >
                          Reset password
                        </button>
                      )}
                    </div>

                    {issued[m.id] && (
                      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                        <p className="mb-1 text-xs font-semibold text-amber-800">
                          One-time temporary password for {m.email}
                        </p>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 select-all rounded bg-amber-100 px-2 py-1 font-mono text-sm text-amber-900">
                            {issued[m.id]}
                          </code>
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard?.writeText(issued[m.id] ?? '')}
                            className="rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800"
                          >
                            Copy
                          </button>
                        </div>
                        <p className="mt-2 text-[11px] text-amber-700">
                          Share it over a secure channel. It won&apos;t be shown again, and the user
                          must set a new password on their next sign-in.
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
