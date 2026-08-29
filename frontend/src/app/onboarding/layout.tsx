'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { computeOnboardingProgress, type OnboardingProgress } from '@/lib/onboardingProgress';
import {
  OnboardingMobileBar,
  OnboardingSidebar,
} from '@/components/onboarding/OnboardingProgressList';
import { SellerModalHeader } from '@/components/seller/SellerModalHeader';

export interface OnboardingStore {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  logoUrl: string | null;
  template: string;
  heroImages: string[];
  heroHeadline: string | null;
  heroSubhead: string | null;
  stripeOnboardingStatus: string;
  deliveryProvider: string;
  deliveryFeeCents: number;
  pickupAddress: string | null;
  published: boolean;
  publishedAt: string | null;
}

interface OnboardingContextValue {
  store: OnboardingStore | null;
  productCount: number;
  progress: OnboardingProgress;
  /** Call after any mutation (store created, product added, brand/payments/delivery
   * saved) so every step's progress stays in sync without a full page reload. */
  refresh: () => void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used within the onboarding layout');
  }
  return ctx;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; store: OnboardingStore | null; productCount: number }
  | { status: 'error'; message: string };

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  const user = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    api<{ store: OnboardingStore; stats: { productCount: number } }>('/api/stores/me')
      .then((res) => {
        if (!cancelled) {
          setState({ status: 'ready', store: res.store, productCount: res.stats.productCount });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: 'ready', store: null, productCount: 0 });
        } else {
          setState({
            status: 'error',
            message: err instanceof ApiError ? err.message : 'Could not load your store.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  if (!user || state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center">
        <p className="text-sm text-red-600">{state.message}</p>
      </div>
    );
  }

  const progress = computeOnboardingProgress(state.store, state.productCount);

  // The only hard lock: no store yet, and trying to view a step other than
  // Business or the bare redirector (which sends itself onward below).
  const isBusinessStep = pathname === '/onboarding/business';
  const isRootRedirector = pathname === '/onboarding';
  if (!progress.hasStore && !isBusinessStep && !isRootRedirector) {
    router.replace('/onboarding/business');
    return null;
  }

  return (
    <OnboardingContext.Provider
      value={{ store: state.store, productCount: state.productCount, progress, refresh }}
    >
      <div className="min-h-screen bg-background font-body">
        <SellerModalHeader closeHref="/dashboard" />
        <OnboardingMobileBar progress={progress} pathname={pathname} />
        <div className="mx-auto flex max-w-5xl gap-10 px-4 py-8 lg:px-8 lg:py-12">
          <OnboardingSidebar progress={progress} pathname={pathname} />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </OnboardingContext.Provider>
  );
}
