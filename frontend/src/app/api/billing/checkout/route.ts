// POST /api/billing/checkout — start a Stripe Checkout for the Vendylio Pro
// subscription. Returns { url } to redirect the merchant to.
//
// The plan itself is never flipped here — that happens when Stripe delivers
// `customer.subscription.created` to /api/webhooks/stripe-billing. This route
// only creates the session (and the Stripe customer on first use).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { prisma } from '@/lib/server/prisma';
import {
  isBillingConfigured,
  getOrCreateBillingCustomer,
  createProCheckoutSession,
  BillingUnconfiguredError,
} from '@/lib/server/billing/stripe-billing';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const ACTIVE_SUB = new Set(['ACTIVE', 'TRIALING']);

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
        { error: 'NO_STORE', message: 'Create a store before upgrading.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (!isBillingConfigured()) {
      return NextResponse.json(
        { error: 'BILLING_NOT_CONFIGURED', message: 'Subscription billing is not available.' },
        { status: 503, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (store.subscriptionStatus && ACTIVE_SUB.has(store.subscriptionStatus)) {
      return NextResponse.json(
        { error: 'ALREADY_SUBSCRIBED', message: 'This store already has an active Pro plan.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    try {
      const customerId = await getOrCreateBillingCustomer(prisma, store, auth.user.email);
      const { url } = await createProCheckoutSession({ customerId, storeId: store.id });
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
        { error: 'BILLING_CHECKOUT_FAILED', message },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }
  });
}
