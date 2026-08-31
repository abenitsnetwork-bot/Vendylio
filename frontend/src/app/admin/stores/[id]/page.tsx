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
  createdAt: string;
  productCount: number;
  orderCount: number;
}

export default function AdminStoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAdminAuth();
  const canResetPassword = can.includes('users:password-reset');

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
          className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
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
                  className="text-sm text-muted-foreground hover:text-primary"
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
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Products</p>
                  <p className="font-semibold text-foreground">{store.productCount}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Orders</p>
                  <Link
                    href={`/admin/orders?storeId=${store.id}`}
                    className="font-semibold text-primary hover:underline"
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
                    : 'border-primary text-primary hover:bg-secondary'
                }`}
              >
                {busy ? 'Saving…' : store.published ? 'Deactivate store' : 'Activate store'}
              </button>
            </Card>

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
                            className="text-sm font-semibold text-foreground hover:text-primary"
                          >
                            {m.name ?? m.email}
                          </Link>
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-primary">
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
                          <code className="flex-1 select-all rounded bg-white px-2 py-1 font-mono text-sm text-foreground">
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
