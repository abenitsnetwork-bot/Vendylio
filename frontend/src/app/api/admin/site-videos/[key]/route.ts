// PUT+DELETE /api/admin/site-videos/[key] — landing page CMS, video slots.
// SUPERADMIN-only. Mirrors /api/admin/site-images/[key]: PUT upserts one
// video slot (url + optional posterUrl), DELETE clears it back to "unset" so
// the marketing component stops rendering that section. `key` must be one of
// the fixed SITE_VIDEO_KEYS — an unrecognized key 404s rather than silently
// creating a row nothing on the landing page will ever read.
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
import { isSiteVideoKey } from '@/lib/siteVideoKeys';

const Body = z.object({
  url: z.string().url(),
  posterUrl: z.string().url().nullable().optional(),
});

interface RouteCtx {
  params: Promise<{ key: string }>;
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

    const { key } = await ctx.params;
    if (!isSiteVideoKey(key)) {
      return NextResponse.json(
        { error: 'UNKNOWN_SITE_VIDEO_KEY', message: `"${key}" is not a known video slot.` },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const video = await prisma.siteVideo.upsert({
      where: { key },
      create: { key, url: parsed.data.url, posterUrl: parsed.data.posterUrl ?? null },
      update: { url: parsed.data.url, posterUrl: parsed.data.posterUrl ?? null },
      select: { key: true, url: true, posterUrl: true, updatedAt: true },
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'site_video.update',
      targetType: 'SiteVideo',
      targetId: key,
      metadata: { url: parsed.data.url },
    });

    return NextResponse.json({ video }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { key } = await ctx.params;
    if (!isSiteVideoKey(key)) {
      return NextResponse.json(
        { error: 'UNKNOWN_SITE_VIDEO_KEY', message: `"${key}" is not a known video slot.` },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // deleteMany (not delete) so clearing an already-unset slot is a no-op
    // 200 rather than a P2025 "record not found" error.
    await prisma.siteVideo.deleteMany({ where: { key } });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'site_video.clear',
      targetType: 'SiteVideo',
      targetId: key,
    });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
