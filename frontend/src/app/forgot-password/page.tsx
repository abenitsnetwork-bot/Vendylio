// AUTH-01 — self-service password recovery, step 1.
//
// POST /api/auth/forgot-password is enumeration-resistant: it always returns
// 200 { ok: true } whether or not the email is registered. This page mirrors
// that — the same confirmation screen shows on success regardless, so the UI
// never reveals whether an account exists.
'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { HCaptchaWidget, hcaptchaEnabled } from '@/components/auth/HCaptchaWidget';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/auth/forgot-password', {
        method: 'POST',
        body: { email, ...(captchaToken ? { captchaToken } : {}) },
      });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_FORGOT_ATTEMPTS') {
        setError('Too many reset requests for this email. Try again in about an hour.');
      } else if (err instanceof ApiError && err.code === 'CAPTCHA_FAILED') {
        setError('Captcha check failed — please try again.');
        setCaptchaToken('');
        setCaptchaNonce((n) => n + 1);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background font-body">
      <PublicNavBar />
      <main className="mx-auto flex max-w-md flex-col justify-center gap-6 px-4 py-16">
        {submitted ? (
          <>
            <div>
              <h1
                className="mb-2 font-headings font-bold text-foreground"
                style={{ fontSize: '32px', letterSpacing: '-0.8px' }}
              >
                Check your email
              </h1>
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong className="text-foreground">{email}</strong>, we
                just sent an 8-character reset code. It expires in 15 minutes.
              </p>
            </div>
            <Link
              href={`/reset-password?email=${encodeURIComponent(email)}`}
              className="inline-flex w-full items-center justify-center rounded-xl bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Enter your reset code
            </Link>
            <p className="text-center text-sm text-muted-foreground">
              Didn&apos;t get it? Check spam, or{' '}
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setError(null);
                }}
                className="font-medium text-primary"
              >
                try again
              </button>
              .
            </p>
          </>
        ) : (
          <>
            <div>
              <h1
                className="mb-2 font-headings font-bold text-foreground"
                style={{ fontSize: '32px', letterSpacing: '-0.8px' }}
              >
                Forgot your password?
              </h1>
              <p className="text-sm text-muted-foreground">
                Enter your email and we&apos;ll send a code to reset it.
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
              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <HCaptchaWidget onVerify={setCaptchaToken} resetSignal={captchaNonce} />
              <Button
                type="submit"
                disabled={submitting || (hcaptchaEnabled() && !captchaToken)}
                className="w-full py-3 text-base"
              >
                {submitting ? 'Sending…' : 'Send reset code'}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground">
              Remembered it?{' '}
              <Link href="/login" className="font-medium text-primary">
                Back to login
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
