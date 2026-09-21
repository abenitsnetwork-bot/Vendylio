// GET + PATCH /api/admin/site-settings — public-facing company info (location,
// contact email, social links) shown on /contact and the marketing footer.
// SUPERADMIN-only, same pattern as /api/admin/settings: singleton row
// (SiteSettings.id === "default"), upserted on PATCH so the very first save
// works without a seed migration.
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
import { getSiteSettings } from '@/lib/server/siteSettings';

const SETTINGS_ID = 'default';

const nullableText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable(),
  );

const nullableEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().email('must be a valid email').max(200).nullable(),
);

const nullableUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().url('must be a valid URL, including https://').max(300).nullable(),
);

const PatchBody = z.object({
  location: nullableText(120),
  contactEmail: nullableEmail,
  websiteUrl: nullableUrl,
  instagramUrl: nullableUrl,
  facebookUrl: nullableUrl,
  twitterUrl: nullableUrl,
  tiktokUrl: nullableUrl,
  linkedinUrl: nullableUrl,
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const settings = await getSiteSettings();
    return NextResponse.json(settings, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const previous = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });

    const updated = await prisma.siteSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...parsed.data },
      update: parsed.data,
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'site_settings.update',
      targetType: 'SiteSettings',
      targetId: SETTINGS_ID,
      metadata: { previous, updated },
    });

    return NextResponse.json(
      {
        location: updated.location,
        contactEmail: updated.contactEmail,
        websiteUrl: updated.websiteUrl,
        instagramUrl: updated.instagramUrl,
        facebookUrl: updated.facebookUrl,
        twitterUrl: updated.twitterUrl,
        tiktokUrl: updated.tiktokUrl,
        linkedinUrl: updated.linkedinUrl,
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
