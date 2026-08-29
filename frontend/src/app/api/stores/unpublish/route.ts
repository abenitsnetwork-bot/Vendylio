// POST /api/stores/unpublish — take a live store back offline.
//
// Flips Store.published to false: the storefront 404s again and checkout
// refuses new orders. `publishedAt` is left untouched so re-publishing keeps
// the original "live since" date. This is a deliberate, reversible teardown
// (renovating the catalogue, going on a long break) — distinct from
// `ordersPaused`, which keeps the storefront visible but stops new orders.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (!store.published) {
      return NextResponse.json(
        { store, alreadyUnpublished: true },
        { headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: { published: false },
    });

    return NextResponse.json({ store: updated }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
