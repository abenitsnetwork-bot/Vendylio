// GET /api/stores/stripe/status — Phase 3 (Stripe Connect).
//
// Returns the caller's stripeOnboardingStatus. The webhook (account.updated)
// is the primary path that keeps this current, but that requires Stripe to
// actually reach this app (not guaranteed in local dev without `stripe
// listen` forwarding) — so when the stored status isn't ACTIVE yet and an
// account exists, this opportunistically re-checks Stripe directly and
// syncs the DB before responding. A no-op once the webhook has already
// caught the account up to ACTIVE.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { prisma } from '@/lib/server/prisma';
import { retrieveAccountCapabilities } from '@/lib/server/payments/stripe-connect';
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

    let status = store.stripeOnboardingStatus;

    if (store.stripeAccountId && status !== 'ACTIVE') {
      try {
        const caps = await retrieveAccountCapabilities(store.stripeAccountId);
        const nextStatus = caps.chargesEnabled && caps.payoutsEnabled ? 'ACTIVE' : status;
        if (nextStatus !== status) {
          await prisma.store.update({
            where: { id: store.id },
            data: { stripeOnboardingStatus: nextStatus },
          });
          status = nextStatus;
        }
      } catch {
        // Stripe unreachable/misconfigured — fall back to the stored value
        // rather than failing the whole status check.
      }
    }

    return NextResponse.json(
      { stripeOnboardingStatus: status, connected: Boolean(store.stripeAccountId) },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
