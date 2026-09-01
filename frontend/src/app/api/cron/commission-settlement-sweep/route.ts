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
import { sweepCommissionSettlement } from '@/lib/server/billing/commission-settlement';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 120_000;

// Phase 1b — invoice merchants whose Cash App / Zelle commission (OWED
// CommissionCharge rows) has piled up past COMMISSION_MIN_INVOICE_CENTS and
// who have no withdrawable balance to withhold it from. `invoice.paid` (→
// stripe-billing webhook) flips those rows to SETTLED.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let result = {
      storesInvoiced: 0,
      chargesInvoiced: 0,
      centsInvoiced: 0,
      skippedBelowMin: 0,
      skippedNoCard: 0,
    };

    await withLease(redis ?? undefined, 'commission-settlement-sweep', LEASE_TTL_MS, async () => {
      result = await sweepCommissionSettlement(prisma);
      if (result.storesInvoiced > 0) {
        log.info('commission-settlement-sweep tick', { ...result, requestId: ctx.requestId });
      }
    });

    return NextResponse.json(
      { ok: true, ...result },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

// Vercel Cron invokes cron paths with GET.
export const GET = POST;
