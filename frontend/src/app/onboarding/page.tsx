'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { SellerModalHeader } from '@/components/seller/SellerModalHeader';
import { StoreSetupForm } from '@/components/seller/StoreSetupForm';

export default function OnboardingPage() {
  const user = useUser();
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api('/api/stores/me')
      .then(() => {
        if (!cancelled) router.replace('/dashboard');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setChecking(false);
        } else {
          // Non-404 failure (network, 401 mid-flight) — let the user try the
          // form anyway rather than getting stuck on a spinner.
          setChecking(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, router]);

  if (!user || checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerModalHeader closeHref="/" />
      <div className="px-4 py-10 lg:px-14 lg:py-14">
        <div className="mx-auto mb-10 max-w-2xl">
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
          >
            Let&apos;s set up your store
          </h1>
          <p className="text-sm text-muted-foreground">
            Just a few details and you&apos;ll be ready to start selling in minutes.
          </p>
        </div>
        <StoreSetupForm />
      </div>
    </div>
  );
}
