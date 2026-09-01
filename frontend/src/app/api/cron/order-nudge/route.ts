export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCronSecret } from '@/lib/server/cron/auth';
import { withLease } from '@/lib/server/leader-lease';
import { nudgeUnfulfilledOrders } from '@/lib/server/orders/nudge';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createLogger } from '@/lib/server/logger';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 60_000;

// ORD-01 (Prompt #15) — hourly backstop for NOTIF-01. The seller already gets an
// email the moment an order is paid; this catches the case where they missed it
// and the order is still sitting at PAID/PREPARING. One reminder per order, ever
// (see lib/server/orders/nudge.ts).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let scanned = 0;
    let nudged = 0;

    await withLease(redis ?? undefined, 'order-nudge', LEASE_TTL_MS, async () => {
      const result = await nudgeUnfulfilledOrders({ prisma });
      scanned = result.scanned;
      nudged = result.nudged;
      log.info('order-nudge tick', { scanned, nudged, requestId: ctx.requestId });
    });

    return NextResponse.json(
      { ok: true, scanned, nudged },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

// Vercel Cron invokes cron routes with GET (Authorization: Bearer $CRON_SECRET
// is still attached). Alias so the scheduled GET hits the same handler.
export const GET = POST;
