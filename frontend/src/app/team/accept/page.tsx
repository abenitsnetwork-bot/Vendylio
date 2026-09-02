'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError, storeCsrfToken } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Peek =
  | {
      status: 'PENDING';
      email: string;
      role: 'ADMIN' | 'MEMBER';
      orgName: string;
      hasAccount: boolean;
    }
  | { status: 'INVALID' | 'USED' | 'EXPIRED' };

const PEEK_MESSAGE: Record<'INVALID' | 'USED' | 'EXPIRED', string> = {
  INVALID: 'This invitation link is not valid.',
  USED: 'This invitation has already been used or revoked.',
  EXPIRED: 'This invitation has expired. Ask the store owner for a new one.',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 font-body">
      <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        {children}
      </div>
    </div>
  );
}

const primaryBtn =
  'inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50';

function AcceptInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, loading, refresh } = useAuth();
  const token = params.get('token') ?? '';
  const nextUrl = `/team/accept?token=${encodeURIComponent(token)}`;

  const [peek, setPeek] = useState<Peek | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    fetch(`/api/team/invites/peek?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d: Peek) => {
        if (live) setPeek(d);
      })
      .catch(() => {
        if (live) setPeek({ status: 'INVALID' });
      });
    return () => {
      live = false;
    };
  }, [token]);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/team/invites/accept', { method: 'POST', body: { token } });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not accept the invitation.');
      setBusy(false);
    }
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/team/invites/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message ?? 'Could not create your account.');
      }
      if (data.csrfToken) storeCsrfToken(data.csrfToken);
      await refresh();
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
      setBusy(false);
    }
  }

  const roleLabel =
    peek?.status === 'PENDING' && peek.role === 'ADMIN' ? 'an admin' : 'a team member';

  return (
    <Shell>
      <h1 className="mb-2 font-headings text-2xl font-bold text-foreground">
        {peek?.status === 'PENDING' ? `Join ${peek.orgName}` : 'Team invitation'}
      </h1>

      {!token && <p className="text-sm text-red-600">This invitation link is missing its token.</p>}

      {token && !peek && <p className="text-sm text-muted-foreground">Loading…</p>}

      {peek && peek.status !== 'PENDING' && (
        <p className="text-sm text-red-600">{PEEK_MESSAGE[peek.status]}</p>
      )}

      {peek?.status === 'PENDING' && (
        <>
          <p className="mb-5 text-sm text-muted-foreground">
            You&apos;ve been invited to join <strong>{peek.orgName}</strong> as {roleLabel}, using{' '}
            <strong>{peek.email}</strong>.
          </p>

          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

          {loading && <p className="text-sm text-muted-foreground">Checking your session…</p>}

          {/* Signed in as the right person → one click. */}
          {!loading && user && user.email.toLowerCase() === peek.email && (
            <button type="button" onClick={accept} disabled={busy} className={primaryBtn}>
              {busy ? 'Joining…' : 'Accept invitation'}
            </button>
          )}

          {/* Signed in as someone else. */}
          {!loading && user && user.email.toLowerCase() !== peek.email && (
            <p className="text-sm text-muted-foreground">
              You&apos;re signed in as <strong>{user.email}</strong>, but this invite is for{' '}
              <strong>{peek.email}</strong>. Log out and sign in with that address.
            </p>
          )}

          {/* Not signed in, account already exists → send them to log in. */}
          {!loading && !user && peek.hasAccount && (
            <a href={`/login?next=${encodeURIComponent(nextUrl)}`} className={primaryBtn}>
              Sign in to accept
            </a>
          )}

          {/* Not signed in, no account yet → set a password right here. */}
          {!loading && !user && !peek.hasAccount && (
            <form onSubmit={claim} className="flex flex-col gap-3 text-left">
              <label className="text-sm font-medium text-foreground" htmlFor="password">
                Choose a password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
                className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent"
              />
              <p className="text-xs text-muted-foreground">
                At least 10 characters. Your account is created for {peek.email}.
              </p>
              <button type="submit" disabled={busy} className={primaryBtn}>
                {busy ? 'Creating your account…' : 'Create account & join'}
              </button>
            </form>
          )}
        </>
      )}
    </Shell>
  );
}

export default function TeamAcceptPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInner />
    </Suspense>
  );
}
