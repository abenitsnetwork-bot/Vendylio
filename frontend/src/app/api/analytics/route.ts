// GET /api/analytics — the seller's storefront analytics (Pro only).
//
// Phase 4a. Reads the daily aggregate tables (StorefrontDayStat /
// ProductViewDayStat) plus paid orders over a 7/30/90-day window and returns
// a chart-ready series + totals + top products. Gated behind
// `planFeatures().advancedAnalytics` — a Free store gets 402
// PLAN_UPGRADE_REQUIRED and the page shows an upgrade card.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { requirePro } from '@/lib/server/middleware/require-pro';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { readAnalytics } from '@/lib/server/analytics/aggregate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const ALLOWED_RANGES = new Set([7, 30, 90]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store first.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const gated = requirePro(store, 'advancedAnalytics');
    if (gated) return gated;

    const rangeParam = Number(new URL(req.url).searchParams.get('range') ?? 30);
    const range = ALLOWED_RANGES.has(rangeParam) ? rangeParam : 30;

    const summary = await readAnalytics(prisma, {
      storeId: store.id,
      tz: store.timezone || 'UTC',
      range,
    });

    return NextResponse.json(summary, { headers: { 'x-request-id': ctx.requestId } });
  });
}
