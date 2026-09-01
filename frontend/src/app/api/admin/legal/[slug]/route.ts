// GET + PUT /api/admin/legal/[slug] — SUPERADMIN edits the legal pages
// (terms / privacy / refund-policy) shown at /terms, /privacy,
// /refund-policy and in the onboarding Terms modal.
//
// SUPERADMIN-only, gated purely on role (same as /api/admin/settings and
// the Site Content CMS) — deliberately NOT added to the locked
// ADMIN/SUPERADMIN `can[]` capability contract in api/admin/me/route.ts.
//
// `body` is Markdown in the safe subset understood by
// lib/legal/parseLegalMarkdown.ts — it is never rendered as raw HTML.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { isLegalSlug } from '@/lib/legal/defaults';
import { getLegalDocument } from '@/lib/server/legal';

interface RouteCtx {
  params: Promise<{ slug: string }>;
}

const PutBody = z.object({
  body: z.string().min(1).max(50_000),
  version: z.string().trim().min(1).max(40),
});

const UNKNOWN_SLUG = { error: 'UNKNOWN_DOCUMENT', message: 'Unknown legal document' } as const;

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { slug } = await ctx.params;
    if (!isLegalSlug(slug)) {
      return NextResponse.json(UNKNOWN_SLUG, {
        status: 400,
        headers: { 'x-request-id': reqCtx.requestId },
      });
    }

    const doc = await getLegalDocument(slug);
    return NextResponse.json(
      {
        slug: doc.slug,
        title: doc.title,
        body: doc.body,
        version: doc.version,
        lastUpdated: doc.lastUpdated,
        isDefault: doc.isDefault,
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}

export async function PUT(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { slug } = await ctx.params;
    if (!isLegalSlug(slug)) {
      return NextResponse.json(UNKNOWN_SLUG, {
        status: 400,
        headers: { 'x-request-id': reqCtx.requestId },
      });
    }

    const parsed = PutBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { body, version } = parsed.data;

    await prisma.legalDocument.upsert({
      where: { slug },
      create: { slug, body, version, updatedBy: auth.admin.id },
      update: { body, version, updatedBy: auth.admin.id },
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'legal.update',
      targetType: 'LegalDocument',
      targetId: slug,
      metadata: { slug, version, bytes: body.length },
    });

    const doc = await getLegalDocument(slug);
    return NextResponse.json(
      {
        slug: doc.slug,
        title: doc.title,
        body: doc.body,
        version: doc.version,
        lastUpdated: doc.lastUpdated,
        isDefault: doc.isDefault,
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
