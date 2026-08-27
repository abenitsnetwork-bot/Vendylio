// GET /api/admin/stats — Phase 10 admin dashboard aggregate metrics. The
// other /api/admin/* routes (users/orders/withdrawals/audit-log) all
// shipped in earlier phases with no UI; this is the one genuinely new
// route Phase 10 needs, since none of them compute a platform-wide summary.
//
// Every number here is derived from existing tables — no new schema:
//   merchantCount        — Organization.count() (one org per seller, MVP 1:1)
//   activeStoreCount     — Store.count({published:true})
//   ordersToday          — Order.count() created since UTC midnight (any status)
//   gmvCents             — sum(Order.amount) over PAID orders, all-time
//   platformRevenueCents — sum(Order.commissionAmount) over PAID orders,
//                          all-time (computeCommission runs on every PAID
//                          order regardless of provider — see
//                          api/webhooks/stripe/route.ts)
//   activeDeliveries     — Delivery.count({status:'REQUESTED'}) (in flight,
//                          not yet DELIVERED/FAILED)
//   failedPayments       — Order.count({status:'FAILED'})
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const now = new Date();
    const [
      merchantCount,
      activeStoreCount,
      ordersToday,
      gmvAgg,
      platformRevenueAgg,
      activeDeliveries,
      failedPayments,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.store.count({ where: { published: true } }),
      prisma.order.count({ where: { createdAt: { gte: startOfUtcDay(now) } } }),
      prisma.order.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
      prisma.order.aggregate({ where: { status: 'PAID' }, _sum: { commissionAmount: true } }),
      prisma.delivery.count({ where: { status: 'REQUESTED' } }),
      prisma.order.count({ where: { status: 'FAILED' } }),
    ]);

    return NextResponse.json(
      {
        merchantCount,
        activeStoreCount,
        ordersToday,
        gmvCents: gmvAgg._sum.amount ?? 0,
        platformRevenueCents: platformRevenueAgg._sum.commissionAmount ?? 0,
        activeDeliveries,
        failedPayments,
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
