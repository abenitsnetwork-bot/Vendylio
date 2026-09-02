// GET /api/admin/reports — the report catalogue + the store list for the
// optional filter. SUPERADMIN only (reports expose platform-wide financials).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { REPORT_LIST } from '@/lib/server/reports/registry';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const stores = await prisma.store.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    return NextResponse.json(
      { reports: REPORT_LIST, stores },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
