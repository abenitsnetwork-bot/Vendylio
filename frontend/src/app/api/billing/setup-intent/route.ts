// POST /api/billing/setup-intent — Phase 1b.
//
// Starts a Stripe Checkout in `mode: 'setup'` so the merchant can put a card
// on file with Vendylio's billing customer. Required before enabling Cash App
// / Zelle (PATCH /api/stores returns PAYMENT_METHOD_REQUIRED otherwise): a
// merchant with no withdrawable balance still needs a way for Vendylio to
// collect the marketplace commission it's owed, via the
// commission-settlement-sweep cron's Stripe invoice.
//
// Returns { url } to redirect to. The card is attached by Stripe Checkout on
// completion; the stripe-billing webhook (checkout.session.completed) promotes
// it to the customer's invoice default.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { requireStoreOwner } from '@/lib/server/team/owner-guard';
import { prisma } from '@/lib/server/prisma';
import {
  isBillingConfigured,
  getOrCreateBillingCustomer,
  createCardSetupSession,
  BillingUnconfiguredError,
} from '@/lib/server/billing/stripe-billing';
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
        { error: 'NO_STORE', message: 'Create a store first.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const ownerGate = await requireStoreOwner(
      store,
      ctx.requestId,
      'Only the store owner can manage billing.',
    );
    if (ownerGate) return ownerGate;

    if (!isBillingConfigured()) {
      return NextResponse.json(
        { error: 'BILLING_NOT_CONFIGURED', message: 'Billing is not available.' },
        { status: 503, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    try {
      const customerId = await getOrCreateBillingCustomer(prisma, store, auth.user.email);
      const { url } = await createCardSetupSession({ customerId, storeId: store.id });
      return NextResponse.json({ url }, { headers: { 'x-request-id': ctx.requestId } });
    } catch (err) {
      if (err instanceof BillingUnconfiguredError) {
        return NextResponse.json(
          { error: 'BILLING_NOT_CONFIGURED', message: 'Billing is not available.' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      const message = err instanceof Error ? err.message : 'Unknown billing error';
      return NextResponse.json(
        { error: 'BILLING_SETUP_FAILED', message },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }
  });
}
