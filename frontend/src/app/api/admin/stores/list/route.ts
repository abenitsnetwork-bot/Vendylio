// GET /api/admin/stores/list — every store as { id, name, slug, published },
// name-sorted, un-paginated. Feeds lightweight pickers in the back-office
// (e.g. the store filter on /admin/orders). A name list stays tiny even at
// thousands of stores; the paginated /api/admin/stores is for browsing.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const stores = await prisma.store.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, published: true },
    });

    return NextResponse.json({ stores }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
