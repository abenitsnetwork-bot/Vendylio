// ADMIN-03 — GET /api/admin/withdrawals (list with status/since/until
// filters, cursor pagination).
//
// IMPORTANT — Withdrawal.requestedAt vs createdAt:
//   The Withdrawal Prisma model uses `requestedAt` as its primary timestamp
//   (schema.prisma:327) — there is no `createdAt` column. Our shared cursor
//   shape `{ createdAt, id }` (notifications/cursor.ts) carries an ISO date
//   field; we re-use the wire format but bind it to `requestedAt` at the
//   `where` clause and emit the next-cursor from the row's `requestedAt`.
//   The wire shape stays compatible with frontend cursor consumers.
//
// We therefore can't use `cursorWhere(cursor)` (it targets `createdAt`) —
// instead we inline the equivalent OR fragment against `requestedAt`. We
// also can't use `buildPage` (it pulls `last.createdAt`) — we slice the
// +1 page and emit the cursor manually using `last.requestedAt`.
//
// destination is JSON containing PII (phone numbers); D-ADMIN-03 explicitly
// permits ADMIN role to read it.
//
// The PATCH/cancel endpoint is SUPERADMIN-only (D-ADMIN-01) and lands in
// Plan 03-06 — out of scope here.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { clampLimit, decodeCursor, encodeCursor } from '@/lib/server/pagination/paginate';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const WITHDRAWAL_SELECT = {
  id: true,
  userId: true,
  amount: true,
  // Phase 1b — Cash App / Zelle commission withheld from this payout. The
  // operator pays the merchant `amount - commissionSettledCents`.
  commissionSettledCents: true,
  currency: true,
  status: true,
  destination: true,
  provider: true,
  providerPayoutId: true,
  failureReason: true,
  requestedAt: true,
  processedAt: true,
  completedAt: true,
  // Attribution — who requested it (the seller/owner) so an operator can see
  // it at a glance without cross-referencing.
  user: { select: { email: true, name: true } },
} as const satisfies Prisma.WithdrawalSelect;

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const status = url.searchParams.get('status');
    const since = parseDate(url.searchParams.get('since'));
    const until = parseDate(url.searchParams.get('until'));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const where: Prisma.WithdrawalWhereInput = {
      ...(status ? { status } : {}),
      ...(since || until
        ? {
            requestedAt: {
              ...(since ? { gte: since } : {}),
              ...(until ? { lte: until } : {}),
            },
          }
        : {}),
      ...(cursor
        ? {
            OR: [
              { requestedAt: { lt: cursor.createdAt } },
              { requestedAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await prisma.withdrawal.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: WITHDRAWAL_SELECT,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.requestedAt, id: last.id }) : null;

    // Resolve the requester's store name (userId → org → store) for the page.
    const userIds = [...new Set(page.map((r) => r.userId))];
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

    const items = page.map(({ user, ...w }) => {
      const store = storeByUser.get(w.userId);
      return {
        ...w,
        requesterEmail: user?.email ?? null,
        requesterName: user?.name ?? null,
        storeName: store?.name ?? null,
        storeSlug: store?.slug ?? null,
      };
    });

    return NextResponse.json({ items, nextCursor }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
