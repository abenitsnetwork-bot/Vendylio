// GET + PATCH /api/admin/settings — platform-wide settings (currently just
// the marketplace commission rate). SUPERADMIN-only, same as the Site
// Content CMS (AdminSidebar.tsx) — gated purely on role rather than added
// to the locked ADMIN/SUPERADMIN `can[]` capability contract in
// api/admin/me/route.ts (see that file's "CAPABILITY LIST CONTRACT" note).
//
// Singleton row (PlatformSettings.id === "default"), upserted on PATCH so
// the very first save works without a seed migration.
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

const SETTINGS_ID = 'default';

const PatchBody = z.object({
  commissionRateBp: z.number().int().min(0).max(10_000),
  commissionRateBpPro: z.number().int().min(0).max(10_000).nullable(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const row = await prisma.platformSettings.findUnique({ where: { id: SETTINGS_ID } });
    return NextResponse.json(
      {
        commissionRateBp: row?.commissionRateBp ?? 0,
        commissionRateBpPro: row?.commissionRateBpPro ?? null,
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
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

    const previous = await prisma.platformSettings.findUnique({ where: { id: SETTINGS_ID } });

    const updated = await prisma.platformSettings.upsert({
      where: { id: SETTINGS_ID },
      create: {
        id: SETTINGS_ID,
        commissionRateBp: parsed.data.commissionRateBp,
        commissionRateBpPro: parsed.data.commissionRateBpPro,
      },
      update: {
        commissionRateBp: parsed.data.commissionRateBp,
        commissionRateBpPro: parsed.data.commissionRateBpPro,
      },
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'settings.commission_rate_change',
      targetType: 'PlatformSettings',
      targetId: SETTINGS_ID,
      metadata: {
        previousCommissionRateBp: previous?.commissionRateBp ?? 0,
        previousCommissionRateBpPro: previous?.commissionRateBpPro ?? null,
        newCommissionRateBp: updated.commissionRateBp,
        newCommissionRateBpPro: updated.commissionRateBpPro,
      },
    });

    return NextResponse.json(
      {
        commissionRateBp: updated.commissionRateBp,
        commissionRateBpPro: updated.commissionRateBpPro,
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
