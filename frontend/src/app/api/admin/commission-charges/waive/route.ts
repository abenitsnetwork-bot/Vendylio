// Phase 1b — POST /api/admin/commission-charges/waive
//
// SUPERADMIN-only. Writes off a store's OUTSTANDING (OWED) Cash App / Zelle
// commission — every OWED row for the store flips to WAIVED. Use for a pilot
// merchant, a goodwill write-off, or a dispute the platform concedes.
// INVOICED rows are left alone (Stripe is already collecting; cancel the
// invoice in the dashboard first if you really mean it).
//
// Audit: action 'commission.waive', metadata { storeId, chargeCount, centsWaived, reason }.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  storeId: z.string().min(1),
  reason: z.string().min(1).max(500),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const { storeId, reason } = parsed.data;

    const owed = await prisma.commissionCharge.findMany({
      where: { storeId, status: 'OWED' },
      select: { id: true, amountCents: true },
    });
    if (owed.length === 0) {
      return NextResponse.json(
        { error: 'NOTHING_OWED', message: 'This store has no outstanding commission.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const centsWaived = owed.reduce((s, r) => s + r.amountCents, 0);

    await prisma.$transaction(async (tx) => {
      await tx.commissionCharge.updateMany({
        where: { id: { in: owed.map((r) => r.id) }, status: 'OWED' },
        data: { status: 'WAIVED', settledAt: new Date() },
      });
      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: 'commission.waive',
        targetType: 'Store',
        targetId: storeId,
        metadata: { storeId, chargeCount: owed.length, centsWaived, reason },
      });
    });

    return NextResponse.json(
      { ok: true, chargeCount: owed.length, centsWaived },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
