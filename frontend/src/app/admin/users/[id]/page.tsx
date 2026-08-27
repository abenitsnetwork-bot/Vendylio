'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useAdminAuth } from '@/contexts/AdminContext';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

const ROLES = ['USER', 'ADMIN', 'SUPERADMIN'];

export default function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAdminAuth();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ user: AdminUser }>(`/api/admin/users/${id}`)
      .then((res) => setUser(res.user))
      .catch((err) => {
        const message =
          err instanceof ApiError && err.code === 'USER_NOT_FOUND'
            ? 'This user no longer exists.'
            : err instanceof ApiError
              ? err.message
              : 'Could not load this user.';
        setError(message);
      });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeRole(role: string) {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/admin/users/${id}/role`, { method: 'PATCH', body: { role } });
      load();
    } catch (err) {
      const map: Record<string, string> = {
        LAST_SUPERADMIN: 'Refusing to demote the last SUPERADMIN.',
      };
      setActionError(
        err instanceof ApiError ? (map[err.code] ?? err.message) : 'Could not change the role.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: 'ACTIVE' | 'SUSPENDED') {
    const reason =
      status === 'SUSPENDED' ? window.prompt('Reason for suspending this account?') : null;
    if (status === 'SUSPENDED' && !reason) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/admin/users/${id}/status`, {
        method: 'PATCH',
        body: { status, ...(reason ? { reason } : {}) },
      });
      load();
    } catch (err) {
      const map: Record<string, string> = {
        RESTORE_REQUIRES_SUPERADMIN: 'Only a SUPERADMIN can restore a suspended account.',
        SUSPEND_REQUIRES_SUPERADMIN: 'Only a SUPERADMIN can suspend a SUPERADMIN account.',
      };
      setActionError(
        err instanceof ApiError ? (map[err.code] ?? err.message) : 'Could not update status.',
      );
    } finally {
      setBusy(false);
    }
  }

  const canChangeRole = can.includes('users:role');
  const canSuspend = can.includes('users:status:suspend');
  const canRestore = can.includes('users:status:restore');

  return (
    <div className="px-4 py-8 font-body lg:px-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/admin/users"
          className="mb-6 flex items-center gap-2 text-sm font-medium text-primary"
        >
          <Icon i="arrow-left" size={16} />
          Back to Users
        </Link>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && !user && <p className="text-sm text-muted-foreground">Loading…</p>}

        {user && (
          <>
            <h1
              className="mb-1 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(22px, 4vw, 28px)' }}
            >
              {user.name ?? user.email}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">{user.email}</p>

            {actionError && <p className="mb-4 text-sm text-red-600">{actionError}</p>}

            <Card className="mb-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Role</p>
                  <p className="font-semibold text-foreground">{user.role}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                  <p className="font-semibold text-foreground">{user.status}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Email verified
                  </p>
                  <p className="font-semibold text-foreground">
                    {user.emailVerifiedAt ? 'Yes' : 'No'}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Joined</p>
                  <p className="font-semibold text-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </Card>

            {canChangeRole && (
              <Card className="mb-6">
                <p className="mb-3 text-sm font-semibold text-foreground">Change role</p>
                <div className="flex gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy || r === user.role}
                      onClick={() => changeRole(r)}
                      className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                        r === user.role
                          ? 'border-primary bg-secondary text-primary'
                          : 'border-border text-foreground hover:bg-secondary'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </Card>
            )}

            {(canSuspend || canRestore) && (
              <Card>
                <p className="mb-3 text-sm font-semibold text-foreground">Account access</p>
                {user.status === 'ACTIVE' && canSuspend && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus('SUSPENDED')}
                    className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 disabled:opacity-50"
                  >
                    Suspend account
                  </button>
                )}
                {user.status === 'SUSPENDED' && canRestore && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => changeStatus('ACTIVE')}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Restore account
                  </button>
                )}
                {user.status === 'SUSPENDED' && !canRestore && (
                  <p className="text-xs text-muted-foreground">
                    Only a SUPERADMIN can restore a suspended account.
                  </p>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
