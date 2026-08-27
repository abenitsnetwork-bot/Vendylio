'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Field, inputClass } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

const PASSWORD_MIN = 10;

export function RegistrationForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!agreed) {
      setError('You must agree to the Terms of Service and Privacy Policy.');
      return;
    }
    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }

    setSubmitting(true);
    try {
      const name = [firstName, lastName].filter(Boolean).join(' ').trim();
      await api('/api/auth/signup', {
        method: 'POST',
        body: { email, password, ...(name ? { name } : {}) },
      });
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      const map: Record<string, string> = {
        PASSWORD_BANNED: 'This password is too common — choose another.',
        PASSWORD_TOO_SHORT: `Password must be at least ${PASSWORD_MIN} characters.`,
        PASSWORD_PWNED: 'This password appeared in a known data breach.',
        TOO_MANY_SIGNUP_ATTEMPTS: 'Too many attempts. Try again later.',
        VALIDATION_FAILED: 'Please check the fields and try again.',
      };
      setError(
        err instanceof ApiError ? (map[err.code] ?? err.message) : 'Network error. Try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-md">
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First Name" htmlFor="firstName">
            <input
              id="firstName"
              className={inputClass}
              placeholder="Your first name"
              autoComplete="given-name"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field label="Last Name" htmlFor="lastName">
            <input
              id="lastName"
              className={inputClass}
              placeholder="Your last name"
              autoComplete="family-name"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Email Address" htmlFor="email">
          <input
            id="email"
            type="email"
            className={inputClass}
            placeholder="you@example.com"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              className={`${inputClass} pr-11`}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={PASSWORD_MIN}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-3 flex items-center text-muted-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <Icon i="eye" size={16} />
            </button>
          </div>
        </Field>

        <div className="flex items-start gap-3">
          <input
            id="agree"
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-5 w-5 flex-shrink-0 rounded border-border"
          />
          <label htmlFor="agree" className="text-sm leading-relaxed text-muted-foreground">
            I agree to Vendylio&apos;s{' '}
            <span className="font-medium text-primary">Terms of Service</span> and{' '}
            <span className="font-medium text-primary">Privacy Policy</span>
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <Button type="submit" disabled={submitting} className="w-full py-3 text-base">
            {submitting ? 'Creating…' : 'Create Account'}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-medium text-primary">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </form>
  );
}
