// PATCH+DELETE /api/admin/testimonials/[id] — Phase (landing page CMS).
// SUPERADMIN-only. PATCH accepts any subset of fields including `visible`
// (moderation toggle, mirrors the Phase 8 Review visible toggle) and
// `sortOrder` (drag-to-reorder in the admin UI writes this).
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

const PatchBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(120).nullable().optional(),
  detail: z.string().trim().max(200).nullable().optional(),
  quote: z.string().trim().min(1).max(1000).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  sortOrder: z.number().int().optional(),
  visible: z.boolean().optional(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const existing = await prisma.testimonial.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'TESTIMONIAL_NOT_FOUND', message: 'No such testimonial.' },
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

    const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));

    const testimonial = await prisma.testimonial.update({ where: { id }, data });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'testimonial.update',
      targetType: 'Testimonial',
      targetId: id,
      metadata: data,
    });

    return NextResponse.json({ testimonial }, { headers: { 'x-request-id': reqCtx.requestId } });
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

    const { id } = await ctx.params;
    const existing = await prisma.testimonial.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'TESTIMONIAL_NOT_FOUND', message: 'No such testimonial.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    await prisma.testimonial.delete({ where: { id } });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'testimonial.delete',
      targetType: 'Testimonial',
      targetId: id,
      metadata: { name: existing.name },
    });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
