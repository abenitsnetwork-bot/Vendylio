'use client';

import { sellerFirstName } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import {
  SellerDashboard,
  type DashboardStats,
  type DashboardStore,
  type RecentOrder,
} from '@/components/seller/SellerDashboard';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      store: DashboardStore;
      stats: DashboardStats;
      recentOrders: RecentOrder[];
    };

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
      api<{ store: DashboardStore; stats: DashboardStats }>('/api/stores/me'),
      api<{ items: RecentOrder[] }>('/api/orders?limit=5'),
    ])
      .then(([storeRes, ordersRes]) => {
        if (!cancelled) {
          setState({
            status: 'ready',
            store: storeRes.store,
            stats: storeRes.stats,
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

  return (
    <SellerDashboard
      greetingName={greetingName}
      userEmail={user.email}
      store={state.store}
      stats={state.stats}
      recentOrders={state.recentOrders}
      onLogout={async () => {
        await logout();
        router.push('/');
      }}
    />
  );
}
