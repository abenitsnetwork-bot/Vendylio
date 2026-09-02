// GET /api/statements — payout statements for the caller's store.
//
// OWNER-only, same as GET /api/withdrawals: a statement itemises the store's
// revenue, commission and payout, so a teammate ADMIN/MEMBER doesn't see it.
// The PDF itself is served by GET /api/statements/[id]/pdf.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { requireStoreOwner } from '@/lib/server/team/owner-guard';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store first.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const ownerGate = await requireStoreOwner(
      store,
      ctx.requestId,
      'Only the store owner can view payout statements.',
    );
    if (ownerGate) return ownerGate;

    const rows = await prisma.withdrawalStatement.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        withdrawalId: true,
        periodFrom: true,
        periodTo: true,
        currency: true,
        grossSalesCents: true,
        totalDeductionsCents: true,
        netPayableCents: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ items: rows }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
