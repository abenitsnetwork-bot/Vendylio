// POST /api/stores/upgrade — Phase 12 (Free/Pro tiers).
//
// A stub, as the plan calls for: flips the caller's store to Store.plan =
// "PRO" with no payment collected and no strict enforcement anywhere else in
// the app. The one benefit that's actually wired up today is a reduced
// marketplace commission when COMMISSION_RATE_BP_PRO is configured — see
// resolveCommissionRateBp() in lib/server/payments/commission.ts, consumed
// by the Stripe webhook's onPaid handler. Everything else a real Pro tier
// would need (billing, custom domains, advanced analytics) is out of scope
// until there's real infra behind it.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { prisma } from '@/lib/server/prisma';
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
        { error: 'NO_STORE', message: 'Create a store before upgrading.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (store.plan === 'PRO') {
      return NextResponse.json(
        { store: { id: store.id, plan: store.plan } },
        { headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: { plan: 'PRO' },
      select: { id: true, plan: true },
    });

    return NextResponse.json({ store: updated }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
