// PATCH /api/reviews/[id] — Phase 8. The seller's only moderation lever:
// toggle `visible` to hide/show a review on their public storefront. Rating
// and text are the buyer's own words and are never editable by the seller.
// Ownership via review.storeId === callerStore.id — 404 (not 403) on
// mismatch, same pattern as every other resource in this codebase.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const PatchBody = z.object({
  visible: z.boolean(),
});

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'REVIEW_NOT_FOUND', message: 'No such review.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { id } = await ctx.params;
    const review = await prisma.review.findFirst({ where: { id, storeId: store.id } });
    if (!review) {
      return NextResponse.json(
        { error: 'REVIEW_NOT_FOUND', message: 'No such review.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.review.update({
      where: { id: review.id },
      data: { visible: parsed.data.visible },
    });

    return NextResponse.json(
      { review: updated },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
