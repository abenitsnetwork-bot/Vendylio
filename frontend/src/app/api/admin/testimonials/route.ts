// GET+POST /api/admin/testimonials — Phase (landing page CMS). SUPERADMIN-only.
// GET returns ALL testimonials (visible and hidden) so the admin UI can
// moderate — the public read (lib/server/landing.ts) filters to visible:true
// separately. POST creates a new one, defaulting to visible: true and
// sortOrder: 0 (admin reorders afterwards via PATCH on the [id] route).
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

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().max(120).nullable().optional(),
  detail: z.string().trim().max(200).nullable().optional(),
  quote: z.string().trim().min(1).max(1000),
  avatarUrl: z.string().url().nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const testimonials = await prisma.testimonial.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json({ testimonials }, { headers: { 'x-request-id': ctx.requestId } });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const testimonial = await prisma.testimonial.create({
      data: {
        name: parsed.data.name,
        location: parsed.data.location ?? null,
        detail: parsed.data.detail ?? null,
        quote: parsed.data.quote,
        avatarUrl: parsed.data.avatarUrl ?? null,
        rating: parsed.data.rating ?? null,
        sortOrder: parsed.data.sortOrder ?? 0,
      },
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'testimonial.create',
      targetType: 'Testimonial',
      targetId: testimonial.id,
      metadata: { name: testimonial.name },
    });

    return NextResponse.json(
      { testimonial },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
