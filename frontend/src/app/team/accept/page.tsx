'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';

export const dynamic = 'force-dynamic';

function AcceptInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { user, loading } = useAuth();
  const token = params.get('token') ?? '';

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextUrl = `/team/accept?token=${encodeURIComponent(token)}`;

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

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 font-body">
      <div className="w-full rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="mb-2 font-headings text-2xl font-bold text-foreground">
          Join a store on Vendylio
        </h1>

        {!token && (
          <p className="text-sm text-red-600">This invitation link is missing its token.</p>
        )}

        {token && loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {token && !loading && !user && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Sign in with the email address the invitation was sent to, then come back to accept.
            </p>
            <a
              href={`/login?next=${encodeURIComponent(nextUrl)}`}
              className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Sign in
            </a>
          </>
        )}

        {token && !loading && user && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              You&apos;re signed in as <strong>{user.email}</strong>. Accept the invitation to get
              access to the store dashboard.
            </p>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={accept}
              disabled={busy}
              className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? 'Joining…' : 'Accept invitation'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function TeamAcceptPage() {
  return (
    <Suspense fallback={null}>
      <AcceptInner />
    </Suspense>
  );
}
