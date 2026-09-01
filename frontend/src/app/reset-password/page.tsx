// AUTH-01 — self-service password recovery, step 2.
//
// Reads `?email=` and `?code=` from the URL (the reset email links here with
// both). POST /api/auth/reset-password consumes the PASSWORD_RESET code, bumps
// tokenVersion (kills every existing session, including a stolen one) and does
// NOT issue cookies — so on success we send the user to /login to sign in
// fresh. The confirm-password field is client-side only; the server takes a
// single `newPassword`.
'use client';

import { Suspense, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';

// Mirrors AUTH_PASSWORD_MIN_LENGTH (server default). Kept as a constant so the
// hint text and the client guard never drift apart.
const PASSWORD_MIN = 10;

const ERROR_COPY: Record<string, string> = {
  VERIFICATION_CODE_INVALID:
    'That reset code is invalid. Request a new one from the "Forgot password" page.',
  VERIFICATION_CODE_EXPIRED:
    'That reset code has expired. Request a new one from the "Forgot password" page.',
  PASSWORD_BANNED: 'That password is too common — pick something harder to guess.',
  PASSWORD_TOO_SHORT: `Your new password must be at least ${PASSWORD_MIN} characters.`,
  PASSWORD_PWNED: 'That password appeared in a known data breach — please choose another.',
  TOO_MANY_RESET_ATTEMPTS: 'Too many attempts. Wait a few minutes and try again.',
  VALIDATION_FAILED: 'Please check the code and password and try again.',
};

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase());
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && newPassword !== confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    if (newPassword.length < PASSWORD_MIN) {
      setError(`Your new password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/auth/reset-password', {
        method: 'POST',
        body: { email, code, newPassword },
      });
      router.push('/login?reset=1');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(ERROR_COPY[err.code ?? ''] ?? err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
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
            Reset your password
          </h1>
          <p className="text-sm text-muted-foreground">
            Enter the code from your email and choose a new password.
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
          <Field label="Reset Code" htmlFor="code">
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
          <Field label="New Password" htmlFor="newPassword">
            <input
              id="newPassword"
              type="password"
              required
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              At least {PASSWORD_MIN} characters.
            </p>
          </Field>
          <Field label="Confirm New Password" htmlFor="confirm">
            <input
              id="confirm"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              aria-invalid={mismatch}
            />
            {mismatch && (
              <p role="alert" className="mt-1.5 text-xs text-red-600">
                The two passwords don&apos;t match.
              </p>
            )}
          </Field>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting || mismatch} className="w-full py-3 text-base">
            {submitting ? 'Resetting…' : 'Reset password'}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-primary">
            Back to login
          </Link>
        </p>
      </main>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
