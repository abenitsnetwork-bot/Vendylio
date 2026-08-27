// Supporting page — not part of the Banani selection, but required so a new
// seller can actually get from /register to a logged-in session. Verified
// sellers land on /onboarding (they have no store yet).
'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, storeCsrfToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const qEmail = params.get('email');
    const qCode = params.get('code');
    if (qEmail && qCode) {
      void verify(qEmail, qCode);
    }
  }, []);

  async function verify(emailValue: string, codeValue: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ csrfToken?: string }>('/api/auth/verify-email', {
        method: 'POST',
        body: { email: emailValue, code: codeValue },
      });
      if (res.csrfToken) storeCsrfToken(res.csrfToken);
      await refresh();
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void verify(email, code);
  }

  return (
    <div className="min-h-screen bg-background font-body">
      <PublicNavBar />
      <main className="mx-auto flex max-w-md flex-col justify-center gap-6 px-4 py-16">
        <div>
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: '32px', letterSpacing: '-0.8px' }}
          >
            Verify your email
          </h1>
          <p className="text-sm text-muted-foreground">
            We sent an 8-character code to your inbox. It expires in 15 minutes.
          </p>
        </div>
        <form onSubmit={onSubmit} className="flex flex-col gap-5">
          <Field label="Email Address" htmlFor="email">
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Verification Code" htmlFor="code">
            <input
              id="code"
              type="text"
              required
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              className={`${inputClass} font-mono uppercase tracking-widest`}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting} className="w-full py-3 text-base">
            {submitting ? 'Verifying…' : 'Verify email'}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Didn&apos;t receive the code?{' '}
          <Link href="/register" className="font-medium text-primary">
            Try signing up again
          </Link>
          .
        </p>
      </main>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}
