// GET /api/stores/me — the seller dashboard's data source.
//
// Phase 4: sales/orders stats are real aggregates over PAID Orders.
// Phase 8: the "today"/"this month" window is anchored to the store's own
// timezone (Store.timezone) instead of UTC — a US merchant's day shouldn't
// roll over at 7 PM. Also returns the store's live open/pause state and the
// pending-order count for the dashboard + nav badge. Phase 4a: `visits` is a
// real 30-day storefront-view sum (StorefrontDayStat) — the headline number
// for every plan; the detailed breakdown lives on the Pro-only
// /dashboard/analytics page (GET /api/analytics).
//
// The actual store-resolution + aggregate queries live in
// `getDashboardOverview` (lib/server/dashboard/overview.ts) — the dashboard
// home page calls that directly (server-side, no HTTP round-trip); this
// route is a thin wrapper around the same function for client consumers
// (SellerSidebar, and anything that refetches after a mutation).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { getDashboardOverview } from '@/lib/server/dashboard/overview';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const overview = await getDashboardOverview(auth.user.sub);
    if (!overview) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    return NextResponse.json(
      { store: overview.store, openState: overview.openState, stats: overview.stats },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
