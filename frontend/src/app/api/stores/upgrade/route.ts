// POST /api/stores/upgrade — DEPRECATED (Phase 1a).
//
// This was a free stub that flipped `Store.plan` to "PRO" with no payment.
// Pro is now a real Stripe subscription: start it via POST /api/billing/checkout
// (Stripe Checkout) and manage it via POST /api/billing/portal. `Store.plan`
// is only ever changed by the stripe-billing webhook or a SUPERADMIN (comped
// pilot). This route is kept as a 410 so any stale client gets a clear signal
// instead of a silent 404.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    return NextResponse.json(
      {
        error: 'USE_BILLING_CHECKOUT',
        message: 'Upgrade to Pro via POST /api/billing/checkout.',
      },
      { status: 410, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
