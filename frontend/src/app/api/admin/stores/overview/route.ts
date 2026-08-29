// GET /api/admin/stores/overview — a visual, at-a-glance summary of every
// store on the platform for the admin dashboard:
//   - a headline strip (total / active / inactive / open / closed + sales,
//     orders, MoM growth, avg rating, top store)
//   - a capped preview list of stores with their contact + health info,
//     ordered by all-time GMV so the busiest stores surface first.
//
// "Open vs closed" is the Phase 8 operating state (published + not paused +
// within hours), NOT the same thing as "active vs inactive" (published).
// See lib/server/store/availability.ts.
//
// ADMIN can read — same level as GET /api/admin/stores (owner identity and
// publish state are no more sensitive than the user PII ADMIN already sees).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { getStoreOpenState } from '@/lib/server/store/availability';
import { startOfStoreMonth } from '@/lib/server/store/timezoneWindow';

const PREVIEW_LIMIT = 12;

type Performance = 'Good' | 'Average' | 'Needs attention';

/**
 * A blunt, explainable health label — not a scientific score. "Good" =
 * loved by customers or clearly transacting; "Needs attention" = published
 * but nothing is happening, or a real body of reviews is unhappy.
 */
function performanceLabel(input: {
  published: boolean;
  avgRating: number | null;
  reviewCount: number;
  paidOrders: number;
}): Performance {
  if (input.reviewCount >= 3 && input.avgRating !== null && input.avgRating < 3.5) {
    return 'Needs attention';
  }
  if (input.published && input.paidOrders === 0) return 'Needs attention';
  if (input.avgRating !== null && input.avgRating >= 4.3 && input.reviewCount >= 3) return 'Good';
  if (input.paidOrders >= 10) return 'Good';
  return 'Average';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const now = new Date();
    // MoM growth is measured on the platform clock (UTC) — individual store
    // timezones don't matter for a single cross-platform number.
    const thisMonthStart = startOfStoreMonth('UTC', now);
    const prevMonthStart = new Date(
      Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 1, 1),
    );

    const [stores, totalOrders, ratingAgg, gmvThisMonth, gmvPrevMonth] = await Promise.all([
      prisma.store.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          name: true,
          logoUrl: true,
          phone: true,
          city: true,
          state: true,
          pickupAddress: true,
          published: true,
          ordersPaused: true,
          timezone: true,
          hours: true,
          template: true,
          _count: { select: { products: true } },
          reviews: { where: { visible: true }, select: { rating: true } },
          orders: { where: { status: 'PAID' }, select: { amount: true } },
        },
      }),
      prisma.order.count(),
      prisma.review.aggregate({ where: { visible: true }, _avg: { rating: true } }),
      prisma.order.aggregate({
        where: { status: 'PAID', createdAt: { gte: thisMonthStart } },
        _sum: { amount: true },
      }),
      prisma.order.aggregate({
        where: {
          status: 'PAID',
          createdAt: { gte: prevMonthStart, lt: thisMonthStart },
        },
        _sum: { amount: true },
      }),
    ]);

    const enriched = stores.map((s) => {
      const gmvCents = s.orders.reduce((sum, o) => sum + o.amount, 0);
      const paidOrders = s.orders.length;
      const reviewCount = s.reviews.length;
      const avgRating =
        reviewCount > 0
          ? Math.round((s.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10
          : null;
      const open = getStoreOpenState({ timezone: s.timezone, hours: s.hours }, now);
      const acceptingOrders = s.published && !s.ordersPaused;
      const isOpen = acceptingOrders && open.openNow;
      const address =
        s.pickupAddress?.trim() || [s.city, s.state].filter(Boolean).join(', ') || null;

      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        logoUrl: s.logoUrl,
        phone: s.phone,
        address,
        template: s.template,
        published: s.published,
        ordersPaused: s.ordersPaused,
        acceptingOrders,
        isOpen,
        openLabel: isOpen
          ? 'Open'
          : !s.published
            ? 'Inactive'
            : s.ordersPaused
              ? 'Paused'
              : 'Closed',
        nextOpenLabel: open.nextOpenLabel,
        avgRating,
        reviewCount,
        productCount: s._count.products,
        paidOrders,
        gmvCents,
        performance: performanceLabel({
          published: s.published,
          avgRating,
          reviewCount,
          paidOrders,
        }),
      };
    });

    const byGmv = [...enriched].sort((a, b) => b.gmvCents - a.gmvCents);
    const activeStores = enriched.filter((s) => s.published).length;
    const openStores = enriched.filter((s) => s.isOpen).length;
    const totalSalesCents = enriched.reduce((sum, s) => sum + s.gmvCents, 0);

    const thisM = gmvThisMonth._sum.amount ?? 0;
    const prevM = gmvPrevMonth._sum.amount ?? 0;
    const salesGrowthPct = prevM > 0 ? Math.round(((thisM - prevM) / prevM) * 1000) / 10 : null;

    const top = byGmv[0];

    return NextResponse.json(
      {
        summary: {
          totalStores: enriched.length,
          activeStores,
          inactiveStores: enriched.length - activeStores,
          openStores,
          closedStores: enriched.length - openStores,
          totalSalesCents,
          totalOrders,
          salesGrowthPct,
          avgRating:
            ratingAgg._avg.rating !== null ? Math.round(ratingAgg._avg.rating * 10) / 10 : null,
          topStore: top && top.gmvCents > 0 ? { name: top.name, slug: top.slug } : null,
        },
        stores: byGmv.slice(0, PREVIEW_LIMIT),
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
