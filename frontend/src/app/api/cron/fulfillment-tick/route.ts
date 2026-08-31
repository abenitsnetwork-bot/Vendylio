/**
 * POST /api/cron/fulfillment-tick — Vercel cron (every ~2 minutes).
 *
 * Thin adapter over `runFulfillmentTick`:
 *   A. dispatch PENDING courier deliveries whose order is READY
 *   B. poll in-flight courier deliveries for intermediate + missed-terminal states
 *   C. purge stale Quote rows
 *
 * Gated by `verifyCronSecret`, coordinated across instances by `withLease`.
 * `export const GET = POST` because Vercel Cron invokes cron paths with GET.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { redis } from '@/lib/server/redis';
import { prisma } from '@/lib/server/prisma';
import { runFulfillmentTick, type FulfillmentTickResult } from '@/lib/server/fulfillment/dispatch';
import { createLogger } from '@/lib/server/logger';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 120_000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let summary: FulfillmentTickResult | null = null;

    await withLease(redis ?? undefined, 'fulfillment-tick', LEASE_TTL_MS, async () => {
      summary = await runFulfillmentTick(prisma);
      log.info('fulfillment-tick', { ...summary, requestId: ctx.requestId });
    });

    return NextResponse.json(
      { ok: true, ...(summary ?? {}) },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

// Vercel Cron invokes cron routes with GET (Authorization: Bearer $CRON_SECRET
// is still attached). Alias so the scheduled GET hits the same handler; POST
// stays for manual curl / the dashboard "Run" button / tests.
export const GET = POST;
