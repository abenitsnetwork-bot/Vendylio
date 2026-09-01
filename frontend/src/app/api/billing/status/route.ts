// GET /api/billing/status — the caller's plan + subscription state, for the
// dashboard billing page and any upgrade prompt. Read-only, derived entirely
// from the Store row (the stripe-billing webhook keeps it current).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { normalizePlan, planFeatures } from '@/lib/server/plan/features';
import { isBillingConfigured, annualBillingAvailable } from '@/lib/server/billing/stripe-billing';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const plan = normalizePlan(store.plan);
    return NextResponse.json(
      {
        plan,
        planSource: store.planSource ?? null,
        subscriptionStatus: store.subscriptionStatus ?? null,
        currentPeriodEnd: store.subscriptionCurrentPeriodEnd
          ? store.subscriptionCurrentPeriodEnd.toISOString()
          : null,
        compExpiresAt: store.planCompExpiresAt ? store.planCompExpiresAt.toISOString() : null,
        interval: store.subscriptionInterval ?? null,
        hasBillingCustomer: Boolean(store.stripeCustomerId),
        billingConfigured: isBillingConfigured(),
        annualAvailable: annualBillingAvailable(),
        features: planFeatures(plan),
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
