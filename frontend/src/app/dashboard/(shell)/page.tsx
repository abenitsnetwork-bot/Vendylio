'use client';

import { sellerFirstName } from '@/lib/utils';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { computeOnboardingProgress, type OnboardingStoreInput } from '@/lib/onboardingProgress';
import { Icon } from '@/components/ui/Icon';
import {
  SellerDashboard,
  type DashboardStats,
  type DashboardStore,
  type DashboardOpenState,
  type RecentOrder,
} from '@/components/seller/SellerDashboard';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      store: DashboardStore;
      onboardingStore: OnboardingStoreInput;
      stats: DashboardStats;
      openState: DashboardOpenState;
      recentOrders: RecentOrder[];
    };

function FinishSetupBanner({ incompleteOptionalCount }: { incompleteOptionalCount: number }) {
  const stepsAway = 1 + incompleteOptionalCount; // the mandatory Products step, plus optional ones still open
  return (
    <Link
      href="/onboarding"
      className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-primary bg-secondary p-5 hover:opacity-90"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">Finish setting up your store</p>
        <p className="text-xs text-muted-foreground">
          You&apos;re {stepsAway} step{stepsAway === 1 ? '' : 's'} away from going live.
        </p>
      </div>
      <span className="flex flex-shrink-0 items-center gap-1 text-sm font-semibold text-primary">
        Continue setup <Icon i="arrow-right" size={14} />
      </span>
    </Link>
  );
}

export default function DashboardPage() {
  const user = useUser();
  const { logout } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setState({ status: 'loading' });
    Promise.all([
      api<{
        store: DashboardStore & OnboardingStoreInput;
        stats: DashboardStats;
        openState: DashboardOpenState;
      }>('/api/stores/me'),
      api<{ items: RecentOrder[] }>('/api/orders?limit=5'),
    ])
      .then(([storeRes, ordersRes]) => {
        if (!cancelled) {
          setState({
            status: 'ready',
            store: storeRes.store,
            onboardingStore: storeRes.store,
            stats: storeRes.stats,
            openState: storeRes.openState,
            recentOrders: ordersRes.items,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          router.replace('/onboarding');
          return;
        }
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Could not load your store.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [user, router, retryCount]);

  if (!user) return null;

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading your dashboard…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm text-red-600">{state.message}</p>
        <button
          type="button"
          onClick={() => setRetryCount((c) => c + 1)}
          className="text-sm font-medium text-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  const greetingName = sellerFirstName(user);
  const progress = computeOnboardingProgress(state.onboardingStore, state.stats.productCount);

  return (
    <SellerDashboard
      greetingName={greetingName}
      userEmail={user.email}
      store={state.store}
      stats={state.stats}
      openState={state.openState}
      recentOrders={state.recentOrders}
      topBanner={
        !progress.mandatoryComplete ? (
          <FinishSetupBanner incompleteOptionalCount={progress.incompleteOptionalCount} />
        ) : undefined
      }
      onLogout={async () => {
        await logout();
        router.push('/');
      }}
    />
  );
}
