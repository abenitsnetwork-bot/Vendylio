// POST /api/track — storefront analytics beacon.
//
// Phase 4a. A tiny client beacon on the public storefront + product pages
// (components/storefront/TrackView.tsx) posts `{ slug, kind, productId? }`
// here; we upsert the per-day counters in lib/server/analytics/aggregate.ts.
//
// Public + guest: NO CSRF (a beacon fires cross-navigation, often via
// sendBeacon which can't attach our header) — instead a per-IP throttle is
// checked before the body is even parsed, same posture as the other public
// routes. Writes only integer counters, never any PII. `vnd_vid` is an
// opaque random id used solely to approximate unique-visitors-per-day.
//
// Always responds 204 — a beacon never reads the body, and an unknown slug
// or a paused/draft store is simply not counted.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { storefrontViewIpLimiter } from '@/lib/server/middleware/rate-limit-by-ip';
import { optionalAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { recordStorefrontView } from '@/lib/server/analytics/aggregate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const VID_COOKIE = 'vnd_vid';
const VID_MAX_AGE = 180 * 24 * 60 * 60; // 180 days

const Body = z.object({
  slug: z.string().trim().min(1).max(200),
  kind: z.enum(['STORE', 'PRODUCT']),
  productId: z.string().trim().min(1).max(60).optional(),
});

function noContent(vid: string, setCookie: boolean): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  if (setCookie) {
    res.cookies.set(VID_COOKIE, vid, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: VID_MAX_AGE,
    });
  }
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const rl = await storefrontViewIpLimiter.check(req);
    if (rl) return rl;

    const existingVid = req.cookies.get(VID_COOKIE)?.value ?? null;
    const newVisitor = !existingVid;
    const vid = existingVid ?? randomBytes(16).toString('hex');

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return noContent(vid, newVisitor);
    const { slug, kind, productId } = parsed.data;

    try {
      const store = await prisma.store.findFirst({
        where: { slug, published: true },
        select: { id: true, timezone: true, organizationId: true },
      });
      if (!store) return noContent(vid, newVisitor);

      // Don't count the owner (or a teammate) previewing their own store.
      const auth = await optionalAuth();
      if (auth) {
        const own = await resolveOwnStore(auth.user.sub);
        if (own?.id === store.id) return noContent(vid, newVisitor);
      }

      await recordStorefrontView(prisma, {
        storeId: store.id,
        tz: store.timezone || 'UTC',
        kind,
        productId: kind === 'PRODUCT' ? (productId ?? null) : null,
        newVisitor,
      });
    } catch (err) {
      // Analytics must never break a page view — log and move on.
      log.warn('track: record failed', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    return noContent(vid, newVisitor);
  });
}
