// POST /api/admin/withdrawals/[id]/complete — mirrors .../cancel/route.ts's
// structure (same lock-then-transaction pattern, same audit shape) for the
// other terminal outcome: the operator has manually sent the seller their
// money via Cash App/Zelle (Withdrawal.provider === 'manual' — there is no
// payout API to call here) and is closing out the request in the app.
//
// Without this route, a completed withdrawal had no way to leave PENDING
// except being CANCELLED — the request would sit PENDING forever even after
// the seller was actually paid, and it would keep being counted as
// "reserved" against their balance with no path to a clean COMPLETED state.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { lockUserTx } from '@/lib/server/withdrawals/lock';

const Body = z.object({
  note: z.string().max(500).optional(),
});

const COMPLETABLE: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING']);

type Discriminator =
  | { kind: 'NOT_FOUND' }
  | { kind: 'NOT_COMPLETABLE' }
  | { kind: 'OK'; withdrawal: { id: string; status: string; userId: string } };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const parsed = Body.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400 },
      );
    }

    const owner = await prisma.withdrawal.findUnique({
      where: { id },
      select: { userId: true },
    });
    if (!owner) {
      return NextResponse.json(
        { error: 'WITHDRAWAL_NOT_FOUND', message: 'Withdrawal not found.' },
        { status: 404 },
      );
    }

    const result: Discriminator = await prisma.$transaction(
      async (tx) => {
        await lockUserTx(tx, owner.userId);

        const w = await tx.withdrawal.findUnique({ where: { id } });
        if (!w) return { kind: 'NOT_FOUND' as const };
        if (!COMPLETABLE.has(w.status)) return { kind: 'NOT_COMPLETABLE' as const };

        const now = new Date();
        const updated = await tx.withdrawal.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            processedAt: w.processedAt ?? now,
            completedAt: now,
          },
        });

        await logAdminAction(tx, {
          actorId: auth.admin.id,
          action: 'withdrawal.complete',
          targetType: 'Withdrawal',
          targetId: id,
          metadata: {
            withdrawalId: id,
            amount: w.amount,
            currency: w.currency,
            previousStatus: w.status,
            ...(parsed.data.note ? { note: parsed.data.note } : {}),
          },
        });

        return { kind: 'OK' as const, withdrawal: updated };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.kind === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'WITHDRAWAL_NOT_FOUND', message: 'Withdrawal not found.' },
        { status: 404 },
      );
    }
    if (result.kind === 'NOT_COMPLETABLE') {
      return NextResponse.json(
        {
          error: 'WITHDRAWAL_NOT_COMPLETABLE',
          message: 'Withdrawal is not in a completable state.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ withdrawal: result.withdrawal }, { status: 200 });
  });
}
