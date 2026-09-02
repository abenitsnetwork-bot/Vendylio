'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { useAdminAuth } from '@/contexts/AdminContext';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  store: { slug: string; name: string } | null;
}

const ROLE_FILTERS = ['', 'USER', 'ADMIN', 'SUPERADMIN'];
const STATUS_FILTERS = ['', 'ACTIVE', 'SUSPENDED'];

export default function AdminUsersPage() {
  const { can } = useAdminAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const buildQs = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        ...(q ? { q } : {}),
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
        ...extra,
      });
      return params.toString();
    },
    [q, role, status],
  );

  const load = useCallback(() => {
    setUsers(null);
    setCursor(null);
    setError(null);
    api<{ items: AdminUser[]; nextCursor: string | null }>(`/api/admin/users?${buildQs()}`)
      .then((res) => {
        setUsers(res.items);
        setCursor(res.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load users.'));
  }, [buildQs]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api<{ items: AdminUser[]; nextCursor: string | null }>(
        `/api/admin/users?${buildQs({ cursor })}`,
      );
      setUsers((prev) => [...(prev ?? []), ...res.items]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more users.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleStatus(user: AdminUser) {
    const nextStatus = user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    setError(null);
    setBusyId(user.id);
    try {
      const res = await api<{ user: { id: string; status: string } }>(
        `/api/admin/users/${user.id}/status`,
        { method: 'PATCH', body: { status: nextStatus } },
      );
      setUsers((prev) =>
        prev ? prev.map((u) => (u.id === user.id ? { ...u, status: res.user.status } : u)) : prev,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this user.');
    } finally {
      setBusyId(null);
    }
  }

  // Capability hints only (see AdminContext) — the route re-checks role
  // server-side. Restoring a SUSPENDED user needs SUPERADMIN; suspending an
  // ACTIVE one only needs ADMIN.
  function canToggle(user: AdminUser): boolean {
    return user.status === 'SUSPENDED'
      ? can.includes('users:status:restore')
      : can.includes('users:status:suspend');
  }

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <h1
        className="mb-6 font-headings font-bold text-foreground"
        style={{ fontSize: 'clamp(24px, 4vw, 32px)', letterSpacing: '-0.8px' }}
      >
        Users
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="mb-6 flex flex-wrap gap-3"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search email or name…"
          className="min-w-48 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          {ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {r || 'All roles'}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s || 'All statuses'}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
        >
          Search
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {!error && users === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!error && users !== null && users.length === 0 && (
        <div className="py-16 text-center">
          <Icon i="users" size={32} className="mx-auto mb-4 text-muted-foreground opacity-50" />
          <p className="text-sm text-muted-foreground">No users match this filter.</p>
        </div>
      )}
      {users && users.length > 0 && (
        <>
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <Link
                  href={`/admin/users/${u.id}`}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm hover:text-accent"
                >
                  <span className="font-semibold text-foreground">{u.store?.name ?? '—'}</span>
                  <span className="text-muted-foreground">›</span>
                  <span className="truncate text-foreground">{u.name ?? u.email}</span>
                  <span className="text-muted-foreground">›</span>
                  <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                  <span className="text-muted-foreground">›</span>
                  <span className="text-xs font-medium text-muted-foreground">{u.role}</span>
                </Link>

                <div className="flex flex-shrink-0 items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      u.status === 'SUSPENDED'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-green-100 text-green-700'
                    }`}
                  >
                    {u.status === 'SUSPENDED' ? 'Inactive' : 'Active'}
                  </span>
                  {canToggle(u) && (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => void toggleStatus(u)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                        u.status === 'SUSPENDED'
                          ? 'border-accent text-accent hover:bg-secondary'
                          : 'border-red-200 text-red-600 hover:bg-red-50'
                      }`}
                    >
                      {busyId === u.id
                        ? 'Saving…'
                        : u.status === 'SUSPENDED'
                          ? 'Activate'
                          : 'Deactivate'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {cursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-6 w-full rounded-lg border border-border bg-card py-3 text-sm font-semibold text-foreground hover:bg-secondary disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
