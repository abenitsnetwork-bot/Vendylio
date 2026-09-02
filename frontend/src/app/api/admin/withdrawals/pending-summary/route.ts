// GET /api/admin/withdrawals/pending-summary — feeds the admin header's
// withdrawal bell. Read-only, ADMIN is enough (same tier as the withdrawals
// list). Returns the queue depth (PENDING / PROCESSING counts) plus the most
// recent actionable requests with their store name resolved.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const RECENT_LIMIT = 12;
const ACTIONABLE = ['PENDING', 'PROCESSING'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const [pendingCount, processingCount, recent] = await Promise.all([
      prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      prisma.withdrawal.count({ where: { status: 'PROCESSING' } }),
      prisma.withdrawal.findMany({
        where: { status: { in: ACTIONABLE } },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take: RECENT_LIMIT,
        select: {
          id: true,
          userId: true,
          amount: true,
          commissionSettledCents: true,
          currency: true,
          status: true,
          destination: true,
          provider: true,
          requestedAt: true,
        },
      }),
    ]);

    // Resolve store names for the recent rows in one query (userId → org → store).
    const userIds = [...new Set(recent.map((r) => r.userId))];
    const memberships = userIds.length
      ? await prisma.organizationMember.findMany({
          where: { userId: { in: userIds } },
          select: {
            userId: true,
            organization: { select: { store: { select: { name: true, slug: true } } } },
          },
        })
      : [];
    const storeByUser = new Map(memberships.map((m) => [m.userId, m.organization.store] as const));

    const items = recent.map((r) => {
      const store = storeByUser.get(r.userId);
      const dest = (r.destination ?? {}) as {
        method?: string;
        cashtag?: string;
        contact?: string;
      };
      const method =
        dest.method === 'CASH_APP'
          ? `Cash App ${dest.cashtag ?? ''}`.trim()
          : dest.method === 'ZELLE'
            ? `Zelle ${dest.contact ?? ''}`.trim()
            : dest.method === 'BANK'
              ? 'Bank (ACH)'
              : (dest.method ?? 'Unknown');
      return {
        id: r.id,
        storeName: store?.name ?? '(no store)',
        storeSlug: store?.slug ?? null,
        amountCents: r.amount,
        netCents: r.amount - r.commissionSettledCents,
        currency: r.currency,
        status: r.status,
        method,
        provider: r.provider,
        requestedAt: r.requestedAt.toISOString(),
      };
    });

    return NextResponse.json(
      { pendingCount, processingCount, items },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
