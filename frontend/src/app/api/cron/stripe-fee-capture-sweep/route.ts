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
import { recordStripeFee } from '@/lib/server/payments/stripe-fee-capture';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const log = createLogger();
const LEASE_TTL_MS = 120_000;
const BATCH_SIZE = 50;
// Stripe usually attaches the Balance Transaction within seconds, but this
// bounds how long a paid order keeps getting retried before we stop asking —
// a permanently-missing fee (bad id, a Charge that genuinely never settles)
// shouldn't be queried forever.
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// Financial architecture (Phase 2D) — the guaranteed-eventually-consistent
// fallback for Stripe processing-fee capture. The fast path is a postCommit
// hook right after payment (webhooks/stripe/route.ts) — this sweep catches
// whatever that opportunistic attempt missed (Balance Transaction not ready
// yet, a transient Stripe error, or the postCommit attempt itself failing).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = verifyCronSecret(req);
  if (fail) return fail;

  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    let recorded = 0;
    let retried = 0;
    let skipped = 0;
    let conflicts = 0;
    let candidateCount = 0;

    await withLease(redis ?? undefined, 'stripe-fee-capture-sweep', LEASE_TTL_MS, async () => {
      const candidates = await prisma.order.findMany({
        where: {
          provider: { in: ['stripe_platform', 'stripe_connect'] },
          stripeFeeCents: null,
          stripePaymentIntentId: { not: null },
          paidAt: { not: null, gte: new Date(Date.now() - LOOKBACK_MS) },
        },
        orderBy: { paidAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true },
      });
      candidateCount = candidates.length;

      for (const { id } of candidates) {
        const outcome = await recordStripeFee(prisma, id);
        if (outcome.status === 'RECORDED') recorded++;
        else if (outcome.status === 'RETRY_LATER') retried++;
        else if (outcome.status === 'CONFLICT') conflicts++;
        else skipped++;
      }

      if (candidateCount > 0) {
        log.info('stripe-fee-capture-sweep tick', {
          candidates: candidateCount,
          recorded,
          retried,
          skipped,
          conflicts,
          requestId: ctx.requestId,
        });
      }
    });

    return NextResponse.json(
      { ok: true, candidates: candidateCount, recorded, retried, skipped, conflicts },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}

// Vercel Cron invokes cron paths with GET.
export const GET = POST;
