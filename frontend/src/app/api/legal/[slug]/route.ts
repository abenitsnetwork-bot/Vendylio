// GET /api/legal/[slug] — public, read-only. Serves the live text of an
// editable legal page (terms / privacy / refund-policy), falling back to
// the bundled default when a SUPERADMIN has never edited it. Consumed by
// the onboarding Terms modal (components/legal/TermsModal.tsx); the public
// /terms, /privacy, /refund-policy pages read getLegalDocument() directly.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { isLegalSlug } from '@/lib/legal/defaults';
import { getLegalDocument } from '@/lib/server/legal';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ slug: string }>;
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const { slug } = await ctx.params;
    if (!isLegalSlug(slug)) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Unknown legal document' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const doc = await getLegalDocument(slug);
    return NextResponse.json(
      {
        slug: doc.slug,
        title: doc.title,
        body: doc.body,
        version: doc.version,
        lastUpdated: doc.lastUpdated,
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
