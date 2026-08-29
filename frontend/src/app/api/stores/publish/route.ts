// POST /api/stores/publish — the server-side "Launch my store" action.
//
// A store is created as a DRAFT (Store.published = false) and stays invisible
// on /s/[slug] and un-orderable via POST /api/orders until it is published.
// This route is the ONLY validated path to flip that bit: it re-reads the
// store fresh and re-checks readiness server-side (spec §52-54 / §175) so a
// stale client checklist — or a second tab that archived the last product
// between "looks ready" and the click — can't push a half-built store live.
//
// Idempotent: calling it on an already-published store is a 200 no-op
// (alreadyPublished: true), never an error — matters for double-clicks and
// the launch page's retry button (spec §116, §161, §216).
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
        { error: 'NO_STORE', message: 'Create your store before launching it.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (store.published) {
      return NextResponse.json(
        { store, alreadyPublished: true },
        { headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // Authoritative readiness check — the launch page's checklist is only a hint.
    const activeProductCount = await prisma.product.count({
      where: { storeId: store.id, status: 'ACTIVE' },
    });
    const missing: string[] = [];
    if (!store.name.trim()) missing.push('STORE_NAME');
    if (activeProductCount < 1) missing.push('ACTIVE_PRODUCT');

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: 'NOT_READY_TO_PUBLISH',
          missing,
          message: 'Your store needs at least one active product before it can go live.',
        },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const updated = await prisma.store.update({
      where: { id: store.id },
      // Keep the original launch moment if the store was published, unpublished
      // and is now being re-published — "live since" shouldn't reset.
      data: { published: true, publishedAt: store.publishedAt ?? new Date() },
    });

    return NextResponse.json({ store: updated }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
