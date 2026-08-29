export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { sweepLowStock } from '@/lib/server/inventory/low-stock';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createLogger } from '@/lib/server/logger';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 60_000;

// Daily safety net for low-stock alerts. markPaid.ts already emits the
// notification on the sale that crosses the threshold; this catches the
// gaps — manual inventory edits, bulk adjustments, a missed enqueue — by
// scanning for products/variants at/below their effective threshold whose
// `lowStockNotifiedAt` is still null and enqueuing the outbox event.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let scanned = 0;
    let enqueued = 0;

    await withLease(redis ?? undefined, 'low-stock-sweep', LEASE_TTL_MS, async () => {
      const result = await sweepLowStock({ prisma });
      scanned = result.scanned;
      enqueued = result.enqueued;
      log.info('low-stock-sweep tick', { scanned, enqueued, requestId: ctx.requestId });
    });

    return NextResponse.json(
      { ok: true, scanned, enqueued },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
