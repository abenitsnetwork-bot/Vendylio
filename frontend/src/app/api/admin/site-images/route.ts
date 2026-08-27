// GET /api/admin/site-images — Phase (landing page CMS). SUPERADMIN-only.
// Returns every known image slot (SITE_IMAGE_KEYS manifest) merged with
// whatever SiteImage rows already exist — a slot nobody has uploaded to yet
// still appears in the list with url: null, so the admin UI always renders
// the full, stable set of editable slots.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { SITE_IMAGE_KEYS, type SiteImageKey } from '@/lib/siteImageKeys';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const rows = await prisma.siteImage.findMany({
      select: { key: true, url: true, altText: true, updatedAt: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));

    const images = SITE_IMAGE_KEYS.map(({ key, label, hint }) => {
      const row = byKey.get(key as SiteImageKey);
      return {
        key,
        label,
        hint,
        url: row?.url ?? null,
        altText: row?.altText ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });

    return NextResponse.json({ images }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
