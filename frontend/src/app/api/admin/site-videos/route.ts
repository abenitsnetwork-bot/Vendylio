// GET /api/admin/site-videos — landing page CMS, video slots. SUPERADMIN-only.
// Mirrors GET /api/admin/site-images: returns every known video slot
// (SITE_VIDEO_KEYS manifest) merged with whatever SiteVideo rows already
// exist — a slot nobody has uploaded to yet still appears with url: null.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { SITE_VIDEO_KEYS, type SiteVideoKey } from '@/lib/siteVideoKeys';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const rows = await prisma.siteVideo.findMany({
      select: { key: true, url: true, posterUrl: true, updatedAt: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));

    const videos = SITE_VIDEO_KEYS.map(({ key, label, hint }) => {
      const row = byKey.get(key as SiteVideoKey);
      return {
        key,
        label,
        hint,
        url: row?.url ?? null,
        posterUrl: row?.posterUrl ?? null,
        updatedAt: row?.updatedAt ?? null,
      };
    });

    return NextResponse.json({ videos }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
