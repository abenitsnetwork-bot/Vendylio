// GET /api/admin/pulse — dashboard-redesign aggregate: per-KPI value + period-
// over-period delta + a 30-day daily series (sparklines) + the current-period
// GMV split by payment method (`revenueMix`, feeds the "Sales revenue" donut),
// plus a system-queue health snapshot. Everything is derived from existing
// tables (Organization,
// Store, Order, Customer, Delivery, OutboxEvent, EmailJob, Withdrawal) — no new
// schema, no fabricated numbers.
//
// Period = trailing 30 UTC days; delta compares it to the 30 days before that.
// This is the one route the redesigned /admin page needs; /api/admin/stats and
// /api/admin/analytics are left untouched.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/** UTC calendar-day key, e.g. "2026-09-01". */
function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** prev>0 ? rounded 1-dp percent change : null — same shape as stores/overview. */
function deltaPct(cur: number, prev: number): number | null {
  return prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;
}

/** Order.provider → the buyer-facing payment-method bucket for the revenue donut. */
function methodLabel(provider: string): 'Card' | 'Cash App' | 'Zelle' | 'Other' {
  if (provider === 'stripe_connect' || provider === 'stripe_platform') return 'Card';
  if (provider === 'cashapp_manual') return 'Cash App';
  if (provider === 'zelle_manual') return 'Zelle';
  return 'Other';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const now = new Date();
    const periodStart = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
    const prevPeriodStart = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY_MS);
    // Orders/customers are read once over the full 60-day span, then split into
    // this-period / prev-period in memory (one query instead of two each).
    const spanStart = prevPeriodStart;

    const [
      merchantsTotal,
      merchantsAdded,
      activeStoresTotal,
      activeStoresAdded,
      activeDeliveries,
      failedThisPeriod,
      failedPrevPeriod,
      paidOrders,
      customers,
      outboxPending,
      outboxFailed,
      emailPending,
      emailFailed,
      withdrawalsPending,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { createdAt: { gte: periodStart } } }),
      prisma.store.count({ where: { published: true } }),
      prisma.store.count({ where: { published: true, publishedAt: { gte: periodStart } } }),
      prisma.delivery.count({ where: { status: 'REQUESTED' } }),
      prisma.order.count({
        where: { status: 'FAILED', createdAt: { gte: periodStart } },
      }),
      prisma.order.count({
        where: { status: 'FAILED', createdAt: { gte: prevPeriodStart, lt: periodStart } },
      }),
      prisma.order.findMany({
        where: { status: 'PAID', paidAt: { gte: spanStart } },
        select: { amount: true, commissionAmount: true, paidAt: true, provider: true },
      }),
      prisma.customer.findMany({
        where: { createdAt: { gte: spanStart } },
        select: { createdAt: true },
      }),
      prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      prisma.outboxEvent.count({ where: { status: { in: ['FAILED', 'DEAD'] } } }),
      prisma.emailJob.count({ where: { status: 'PENDING' } }),
      prisma.emailJob.count({ where: { status: { in: ['FAILED', 'DEAD'] } } }),
      prisma.withdrawal.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
    ]);

    // ── Daily buckets (last 30 UTC days, oldest first) ───────────────────────
    const days: string[] = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
      days.push(dayKey(new Date(now.getTime() - i * DAY_MS)));
    }
    const daily = new Map(
      days.map((d) => [
        d,
        { date: d, gmvCents: 0, orderCount: 0, newCustomers: 0, revenueCents: 0 },
      ]),
    );

    // ── Split the 60-day reads into this-period / prev-period + fill daily ───
    let gmvCur = 0;
    let gmvPrev = 0;
    let ordersCur = 0;
    let ordersPrev = 0;
    let revenueCur = 0;
    let revenuePrev = 0;
    // Current-period GMV split by payment method — feeds the "Sales revenue" donut.
    const mix = new Map<string, { gmvCents: number; orderCount: number }>();
    for (const o of paidOrders) {
      if (!o.paidAt) continue;
      const inCur = o.paidAt >= periodStart;
      const inPrev = o.paidAt >= prevPeriodStart && o.paidAt < periodStart;
      if (inCur) {
        gmvCur += o.amount;
        ordersCur += 1;
        revenueCur += o.commissionAmount ?? 0;
        const method = methodLabel(o.provider);
        const m = mix.get(method) ?? { gmvCents: 0, orderCount: 0 };
        m.gmvCents += o.amount;
        m.orderCount += 1;
        mix.set(method, m);
        const bucket = daily.get(dayKey(o.paidAt));
        if (bucket) {
          bucket.gmvCents += o.amount;
          bucket.orderCount += 1;
          bucket.revenueCents += o.commissionAmount ?? 0;
        }
      } else if (inPrev) {
        gmvPrev += o.amount;
        ordersPrev += 1;
        revenuePrev += o.commissionAmount ?? 0;
      }
    }
    const revenueMix = [...mix.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.gmvCents - a.gmvCents);

    let customersCur = 0;
    let customersPrev = 0;
    for (const c of customers) {
      const inCur = c.createdAt >= periodStart;
      const inPrev = c.createdAt >= prevPeriodStart && c.createdAt < periodStart;
      if (inCur) {
        customersCur += 1;
        const bucket = daily.get(dayKey(c.createdAt));
        if (bucket) bucket.newCustomers += 1;
      } else if (inPrev) {
        customersPrev += 1;
      }
    }

    type Bucket = {
      gmvCents: number;
      orderCount: number;
      newCustomers: number;
      revenueCents: number;
    };
    const spark = (pick: (b: Bucket) => number) => days.map((d) => pick(daily.get(d)!));

    return NextResponse.json(
      {
        periodDays: WINDOW_DAYS,
        kpis: {
          gmv: {
            value: gmvCur,
            deltaPct: deltaPct(gmvCur, gmvPrev),
            spark: spark((b) => b.gmvCents),
          },
          orders: {
            value: ordersCur,
            deltaPct: deltaPct(ordersCur, ordersPrev),
            spark: spark((b) => b.orderCount),
          },
          newCustomers: {
            value: customersCur,
            deltaPct: deltaPct(customersCur, customersPrev),
            spark: spark((b) => b.newCustomers),
          },
          platformRevenue: {
            value: revenueCur,
            deltaPct: deltaPct(revenueCur, revenuePrev),
            spark: spark((b) => b.revenueCents),
          },
          merchants: { value: merchantsTotal, addedInPeriod: merchantsAdded },
          activeStores: { value: activeStoresTotal, addedInPeriod: activeStoresAdded },
          activeDeliveries: { value: activeDeliveries },
          failedPayments: {
            value: failedThisPeriod,
            deltaPct: deltaPct(failedThisPeriod, failedPrevPeriod),
          },
        },
        revenueMix,
        daily: days.map((d) => daily.get(d)!),
        queue: {
          outboxPending,
          outboxFailed,
          emailPending,
          emailFailed,
          deliveriesInFlight: activeDeliveries,
          withdrawalsPending,
        },
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
