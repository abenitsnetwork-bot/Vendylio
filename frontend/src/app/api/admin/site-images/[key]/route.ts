// PUT+DELETE /api/admin/site-images/[key] — Phase (landing page CMS).
// SUPERADMIN-only. PUT upserts one image slot; DELETE clears it back to
// "unset" so the marketing component falls back to its placeholder — this is
// the only way to remove an image, since url is a required non-empty string
// (an empty-string PUT would fail validation, not clear the slot). `key`
// must be one of the fixed SITE_IMAGE_KEYS — this is a manifest of known
// homepage slots, not a free-form CMS field, so an unrecognized key 404s
// rather than silently creating/deleting a row nothing on the landing page
// will ever read.
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
import { isSiteImageKey } from '@/lib/siteImageKeys';

const Body = z.object({
  url: z.string().url(),
  altText: z.string().trim().max(200).nullable().optional(),
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
    if (!isSiteImageKey(key)) {
      return NextResponse.json(
        { error: 'UNKNOWN_SITE_IMAGE_KEY', message: `"${key}" is not a known image slot.` },
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

    const image = await prisma.siteImage.upsert({
      where: { key },
      create: { key, url: parsed.data.url, altText: parsed.data.altText ?? null },
      update: { url: parsed.data.url, altText: parsed.data.altText ?? null },
      select: { key: true, url: true, altText: true, updatedAt: true },
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'site_image.update',
      targetType: 'SiteImage',
      targetId: key,
      metadata: { url: parsed.data.url },
    });

    return NextResponse.json({ image }, { headers: { 'x-request-id': reqCtx.requestId } });
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
    if (!isSiteImageKey(key)) {
      return NextResponse.json(
        { error: 'UNKNOWN_SITE_IMAGE_KEY', message: `"${key}" is not a known image slot.` },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // deleteMany (not delete) so clearing an already-unset slot is a no-op
    // 200 rather than a P2025 "record not found" error.
    await prisma.siteImage.deleteMany({ where: { key } });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'site_image.clear',
      targetType: 'SiteImage',
      targetId: key,
    });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
