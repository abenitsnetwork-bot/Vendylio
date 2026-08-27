// POST /api/stores/stripe/onboard — Phase 3 (Stripe Connect).
//
// Creates an Express connected account for the caller's store if it doesn't
// have one yet, then returns a fresh Stripe-hosted onboarding URL. Safe to
// call repeatedly — a store that already has a stripeAccountId just gets a
// new onboarding link (Stripe's account_onboarding links are single-use /
// short-lived, so re-requesting is the normal flow if the seller drops off
// or the link expires).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { prisma } from '@/lib/server/prisma';
import {
  createExpressAccount,
  createOnboardingLink,
  StripeConnectUnconfiguredError,
} from '@/lib/server/payments/stripe-connect';
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
        { error: 'NO_STORE', message: 'Create a store before connecting Stripe.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    try {
      let accountId = store.stripeAccountId;
      if (!accountId) {
        accountId = await createExpressAccount(auth.user.email);
        await prisma.store.update({
          where: { id: store.id },
          data: { stripeAccountId: accountId, stripeOnboardingStatus: 'PENDING' },
        });
      }

      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      const returnUrl = `${appUrl}/dashboard/settings?tab=payments`;
      const url = await createOnboardingLink(accountId, returnUrl, returnUrl);

      return NextResponse.json({ url }, { headers: { 'x-request-id': ctx.requestId } });
    } catch (err) {
      if (err instanceof StripeConnectUnconfiguredError) {
        return NextResponse.json(
          { error: 'PAYMENT_PROVIDER_UNCONFIGURED', message: 'Stripe is not configured.' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      const message = err instanceof Error ? err.message : 'Unknown Stripe error';
      return NextResponse.json(
        { error: 'STRIPE_CONNECT_FAILED', message },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }
  });
}
