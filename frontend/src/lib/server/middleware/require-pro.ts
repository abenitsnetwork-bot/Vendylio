// Phase 1a — route guard for Pro-only capabilities.
//
// Mirrors the `verifyCsrf` / `verifyCronSecret` shape: returns a
// `NextResponse` (402) to bail on, or `null` to proceed. The caller has
// already resolved the store (via `resolveOwnStore`) and checked ownership —
// this only checks the plan, so it stays a pure sync function with no DB hit.
//
//   const store = await resolveOwnStore(auth.user.sub);
//   const gated = requirePro(store, 'promoCodes');
//   if (gated) return gated;
//
// NOT wired into any route in Phase 1a — the feature gates land in Phase 3.
// Shipped now so the policy has a home and the billing pipe has a consumer
// to test against.
import 'server-only';
import { NextResponse } from 'next/server';
import { isPro, type PlanFeatures } from '@/lib/server/plan/features';

/** A Pro-gated capability name, for the error payload + client messaging. */
export type ProFeature = keyof PlanFeatures;

export function requirePro(
  store: { plan: string | null | undefined } | null,
  feature: ProFeature,
): NextResponse | null {
  if (store && isPro(store)) return null;
  return NextResponse.json(
    {
      error: 'PLAN_UPGRADE_REQUIRED',
      feature,
      message: 'This feature is available on the Pro plan.',
    },
    { status: 402 },
  );
}
