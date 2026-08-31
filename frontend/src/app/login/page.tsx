// Supporting page — not part of the Banani "Marché Express" selection, but
// required for the register → verify → sign-in loop to actually work.
// Styled to match the Vendylio design tokens for visual coherence.
'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError, storeCsrfToken } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { HCaptchaWidget, hcaptchaEnabled } from '@/components/auth/HCaptchaWidget';

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ csrfToken?: string }>('/api/auth/login', {
        method: 'POST',
        body: { email, password, ...(captchaToken ? { captchaToken } : {}) },
      });
      if (res.csrfToken) storeCsrfToken(res.csrfToken);
      await refresh();

      // Admins/superadmins go straight to the back office — a store-less
      // admin account (the normal shape, see CLAUDE.md) would otherwise land
      // on /dashboard, 404 on GET /api/stores/me, and get bounced into
      // onboarding to create a store it was never meant to have.
      try {
        await api('/api/admin/me');
        router.push('/admin');
      } catch {
        router.push('/dashboard');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unknown error');
      if (err instanceof ApiError && err.code === 'CAPTCHA_FAILED') {
        setCaptchaToken('');
        setCaptchaNonce((n) => n + 1);
      }
    } finally {
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
            Welcome back
          </h1>
          <p className="text-sm text-muted-foreground">Log in to manage your store.</p>
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
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          No account?{' '}
          <Link href="/register" className="font-medium text-primary">
            Open your store
          </Link>
        </p>
      </main>
    </div>
  );
}
