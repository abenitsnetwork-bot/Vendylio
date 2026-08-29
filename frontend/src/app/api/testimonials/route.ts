// POST /api/testimonials — a seller submits a testimonial about Vendylio
// for the marketing landing page.
//
// Created as a DRAFT (visible: false). It shows up in the SUPERADMIN's
// /admin/site-content moderation list alongside admin-authored ones; an
// admin edits / reorders / publishes it there. Nothing a seller submits
// reaches the public homepage without that approval.
//
// No schema change: the seller's identity is denormalised onto the
// Testimonial row (name from the User, `detail` = store name, location from
// the store). Anti-spam is a 24h dedup on (detail = store name) rather than
// a Redis limiter — the row is invisible until an admin acts, so the blast
// radius of abuse is a longer moderation queue, nothing public.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  quote: z.string().trim().min(10).max(1000),
  rating: z.number().int().min(1).max(5).optional(),
});

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const ownStore = await resolveOwnStore(auth.user.sub);
    if (!ownStore) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Open your store before leaving a testimonial.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const [user, store] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.user.sub },
        select: { name: true, email: true },
      }),
      prisma.store.findUnique({
        where: { id: ownStore.id },
        select: { name: true, city: true, state: true },
      }),
    ]);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Store not found.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const recent = await prisma.testimonial.findFirst({
      where: { detail: store.name, createdAt: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) } },
      select: { id: true },
    });
    if (recent) {
      return NextResponse.json(
        {
          error: 'TESTIMONIAL_ALREADY_SUBMITTED',
          message: "You've already sent a testimonial recently — thanks! We'll review it soon.",
        },
        { status: 429, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const name =
      user?.name?.trim() ||
      (user?.email ?? auth.user.email ?? '').split('@')[0] ||
      'A Vendylio seller';
    const location = [store.city, store.state].filter(Boolean).join(', ') || null;

    await prisma.testimonial.create({
      data: {
        name,
        location,
        detail: store.name,
        quote: parsed.data.quote,
        rating: parsed.data.rating ?? null,
        visible: false, // draft — a SUPERADMIN publishes it from /admin/site-content
      },
    });

    return NextResponse.json(
      { ok: true, status: 'PENDING_REVIEW' },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
