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
import { sweepExpiredPlans } from '@/lib/server/billing/downgrade';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 60_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let result = { compExpired: 0, subscriptionLapsed: 0 };

    await withLease(redis ?? undefined, 'plan-downgrade-sweep', LEASE_TTL_MS, async () => {
      result = await sweepExpiredPlans(prisma);
      if (result.compExpired > 0 || result.subscriptionLapsed > 0) {
        log.info('plan-downgrade-sweep tick', { ...result, requestId: ctx.requestId });
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
