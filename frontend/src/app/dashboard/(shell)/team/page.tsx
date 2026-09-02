'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Card } from '@/components/ui/Card';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { ProUpgradeCard } from '@/components/seller/ProUpgradeCard';

interface Member {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  isYou: boolean;
  createdAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  status: string;
  expiresAt: string;
  createdAt: string;
}

interface TeamResponse {
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  canManage: boolean;
  isOwner: boolean;
  plan: 'FREE' | 'PRO';
  teamMembersEnabled: boolean;
  members: Member[];
  invites: Invite[];
}

export default function TeamPage() {
  const user = useUser();
  const { logout } = useAuth();
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<TeamResponse>('/api/team')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load team.'));
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ inviteUrl: string }>('/api/team/invites', {
        method: 'POST',
        body: { email: email.trim(), role },
      });
      setEmail('');
      setRole('MEMBER');
      setNotice(`Invite sent. Link: ${res.inviteUrl}`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the invite.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this invitation?')) return;
    try {
      await api(`/api/team/invites/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke.');
    }
  }

  async function changeRole(m: Member, next: 'ADMIN' | 'MEMBER') {
    try {
      await api(`/api/team/members/${m.id}`, { method: 'PATCH', body: { role: next } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the role.');
    }
  }

  async function remove(m: Member) {
    if (!confirm(m.isYou ? 'Leave this team?' : `Remove ${m.email}?`)) return;
    try {
      await api(`/api/team/members/${m.id}`, { method: 'DELETE' });
      if (m.isYou) {
        window.location.href = '/dashboard';
        return;
      }
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove the member.');
    }
  }

  if (!user) return null;

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
          <div className="mb-8">
            <Link
              href="/dashboard"
              className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
            >
              <Icon i="arrow-left" size={16} />
              Back to Dashboard
            </Link>
            <h1
              className="mb-2 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
            >
              Team
            </h1>
            <p className="text-base text-muted-foreground">
              Invite people to help run your store. Owners keep sole control of payouts and billing.
            </p>
          </div>

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
          {notice && (
            <p className="mb-4 break-all rounded-lg border border-border bg-secondary/40 p-3 text-xs text-foreground">
              {notice}
            </p>
          )}

          {!data && !error && <p className="text-sm text-muted-foreground">Loading…</p>}

          {data && (
            <>
              <Card className="mb-6">
                <h2 className="mb-4 font-headings text-lg font-bold text-foreground">Members</h2>
                <div className="space-y-2">
                  {data.members.map((m) => (
                    <div
                      key={m.id}
                      className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {m.name || m.email}
                          {m.isYou && (
                            <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
                          {m.role}
                        </span>
                        {data.isOwner && m.role !== 'OWNER' && (
                          <>
                            <button
                              type="button"
                              onClick={() => changeRole(m, m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN')}
                              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary"
                            >
                              Make {m.role === 'ADMIN' ? 'Member' : 'Admin'}
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(m)}
                              className="rounded-md border border-border px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                            >
                              Remove
                            </button>
                          </>
                        )}
                        {!data.isOwner && m.isYou && m.role !== 'OWNER' && (
                          <button
                            type="button"
                            onClick={() => remove(m)}
                            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Leave
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {data.invites.length > 0 && (
                <Card className="mb-6">
                  <h2 className="mb-4 font-headings text-lg font-bold text-foreground">
                    Pending invites
                  </h2>
                  <div className="space-y-2">
                    {data.invites.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
                      >
                        <div>
                          <p className="font-medium text-foreground">{inv.email}</p>
                          <p className="text-xs text-muted-foreground">
                            {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                          </p>
                        </div>
                        {data.canManage && (
                          <button
                            type="button"
                            onClick={() => revoke(inv.id)}
                            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {data.canManage && !data.teamMembersEnabled && (
                <ProUpgradeCard title="Team members are a Pro feature">
                  Invite staff with Admin or Member roles to help manage products and orders. Your
                  existing team keeps access if you ever downgrade.
                </ProUpgradeCard>
              )}

              {data.canManage && data.teamMembersEnabled && (
                <Card>
                  <h2 className="mb-4 font-headings text-lg font-bold text-foreground">
                    Invite someone
                  </h2>
                  <form onSubmit={invite} className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="email"
                      required
                      placeholder="teammate@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                    />
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as 'ADMIN' | 'MEMBER')}
                      className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                    >
                      <option value="MEMBER">Member</option>
                      {data.myRole === 'OWNER' && <option value="ADMIN">Admin</option>}
                    </select>
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-50"
                    >
                      {busy ? 'Sending…' : 'Send invite'}
                    </button>
                  </form>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
