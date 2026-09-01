// POST /api/billing/portal — open the Stripe-hosted billing portal so the
// merchant can update their card, view invoices, or cancel. Returns { url }.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { requireStoreOwner } from '@/lib/server/team/owner-guard';
import { createPortalSession, BillingUnconfiguredError } from '@/lib/server/billing/stripe-billing';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const ownerGate = await requireStoreOwner(
      store,
      ctx.requestId,
      'Only the store owner can manage billing.',
    );
    if (ownerGate) return ownerGate;

    if (!store.stripeCustomerId) {
      return NextResponse.json(
        {
          error: 'NO_BILLING_CUSTOMER',
          message: 'Start a Pro subscription before opening the billing portal.',
        },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    try {
      const { url } = await createPortalSession({ customerId: store.stripeCustomerId });
      return NextResponse.json({ url }, { headers: { 'x-request-id': ctx.requestId } });
    } catch (err) {
      if (err instanceof BillingUnconfiguredError) {
        return NextResponse.json(
          { error: 'BILLING_NOT_CONFIGURED', message: 'Subscription billing is not available.' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      const message = err instanceof Error ? err.message : 'Unknown billing error';
      return NextResponse.json(
        { error: 'BILLING_PORTAL_FAILED', message },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }
  });
}
