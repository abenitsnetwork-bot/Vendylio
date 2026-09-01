// Phase 1b — GET /api/admin/commission-charges
//
// The platform's Cash App / Zelle marketplace-commission receivable, grouped
// by store: how much each merchant OWES, how much is already INVOICED (billed,
// awaiting `invoice.paid`), and how old the oldest uncollected charge is.
// Read-only; ADMIN is enough (D-ADMIN-03 — same tier that can read withdrawal
// destinations). The WAIVE action is SUPERADMIN-only, in the sibling route.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface StoreRow {
  storeId: string;
  storeName: string;
  storeSlug: string;
  owedCents: number;
  invoicedCents: number;
  chargeCount: number;
  oldestOwedAt: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const grouped = await prisma.commissionCharge.groupBy({
      by: ['storeId', 'status'],
      where: { status: { in: ['OWED', 'INVOICED'] } },
      _sum: { amountCents: true },
      _count: { _all: true },
      _min: { createdAt: true },
    });

    const storeIds = [...new Set(grouped.map((g) => g.storeId))];
    const stores = await prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true, slug: true },
    });
    const storeById = new Map(stores.map((s) => [s.id, s]));

    const rowByStore = new Map<string, StoreRow>();
    for (const g of grouped) {
      const s = storeById.get(g.storeId);
      const row =
        rowByStore.get(g.storeId) ??
        ({
          storeId: g.storeId,
          storeName: s?.name ?? '(deleted store)',
          storeSlug: s?.slug ?? '',
          owedCents: 0,
          invoicedCents: 0,
          chargeCount: 0,
          oldestOwedAt: null,
        } satisfies StoreRow);

      const sum = g._sum.amountCents ?? 0;
      row.chargeCount += g._count._all;
      if (g.status === 'OWED') {
        row.owedCents += sum;
        row.oldestOwedAt = g._min.createdAt ? g._min.createdAt.toISOString() : null;
      } else {
        row.invoicedCents += sum;
      }
      rowByStore.set(g.storeId, row);
    }

    const rows = [...rowByStore.values()].sort((a, b) => b.owedCents - a.owedCents);
    const totals = rows.reduce(
      (t, r) => ({
        owedCents: t.owedCents + r.owedCents,
        invoicedCents: t.invoicedCents + r.invoicedCents,
        storeCount: t.storeCount + 1,
      }),
      { owedCents: 0, invoicedCents: 0, storeCount: 0 },
    );

    return NextResponse.json(
      { totals, stores: rows },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
