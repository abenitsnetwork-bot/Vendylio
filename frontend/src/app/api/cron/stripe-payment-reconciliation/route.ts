export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createLogger } from '@/lib/server/logger';
import { runReconciliation } from '@/lib/server/payments/reconciliation';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 60_000;

// Financial architecture (Phase 2F) — detection-only Stripe payment
// reconciliation. Daily (03:00) sweep for a PENDING Order whose Checkout
// Session Stripe reports as paid — a missed/failed webhook delivery. Writes
// only an immutable RECONCILIATION_DISCREPANCY FinancialEvent; never mutates
// Order state, commission, or balance. See lib/server/payments/
// reconciliation.ts for the full detection logic and eligibility criteria.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let summary = {
      eligibleOrders: 0,
      checkedOrders: 0,
      paidDiscrepancies: 0,
      alreadyRecorded: 0,
      stripeErrors: 0,
      notFound: 0,
      skipped: 0,
    };

    await withLease(redis ?? undefined, 'stripe-payment-reconciliation', LEASE_TTL_MS, async () => {
      summary = await runReconciliation(prisma);

      if (summary.eligibleOrders > 0) {
        log.info('stripe-payment-reconciliation tick', { ...summary, requestId: ctx.requestId });
      }
      if (summary.paidDiscrepancies > 0) {
        log.error('stripe-payment-reconciliation: discrepancies detected this run', {
          paidDiscrepancies: summary.paidDiscrepancies,
          requestId: ctx.requestId,
        });
      }
    });

    return NextResponse.json(
      { ok: true, ...summary },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

// Vercel Cron invokes cron paths with GET.
export const GET = POST;
