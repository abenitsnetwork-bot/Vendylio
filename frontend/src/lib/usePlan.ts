'use client';

import { useApi } from './useApi';
import type { PlanFeatures } from '@/lib/server/plan/features';

export interface PlanStatus {
  plan: 'FREE' | 'PRO';
  planSource: 'SUBSCRIPTION' | 'COMP' | null;
  subscriptionStatus: 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED' | null;
  currentPeriodEnd: string | null;
  compExpiresAt: string | null;
  hasBillingCustomer: boolean;
  billingConfigured: boolean;
  features: PlanFeatures;
}

/**
 * Client hook for the signed-in merchant's plan + subscription state.
 * Reads GET /api/billing/status (SWR-cached). `isPro` is a convenience;
 * `features` is the same object `planFeatures()` returns server-side so the
 * UI can gate on the exact same flags a route does — never for authorization,
 * only for showing / hiding upgrade prompts.
 */
export function usePlan(options: { skip?: boolean } = {}): {
  status: PlanStatus | null;
  isPro: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { data, loading, error, refresh } = useApi<PlanStatus>('/api/billing/status', {
    skip: options.skip ?? false,
  });
  return {
    status: data,
    isPro: data?.plan === 'PRO',
    loading,
    error,
    refresh,
  };
}
