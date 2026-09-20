// POST /api/contact — the public /contact page's form.
//
// Public + guest-safe: per-IP throttle before the body parse, guest CSRF
// (any header passes for a true guest, same pattern as /api/business-waitlist).
// No admin notification email — read via the "Contact messages" admin report
// (/admin/reports), same as BusinessLead.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { contactIpLimiter } from '@/lib/server/middleware/rate-limit-by-ip';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  topic: z.string().trim().max(80).optional(),
  message: z.string().trim().min(1).max(4000),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const rl = await contactIpLimiter.check(req);
    if (rl) return rl;

    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    await prisma.contactMessage.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        ...(parsed.data.topic ? { topic: parsed.data.topic } : {}),
        message: parsed.data.message,
      },
    });

    return NextResponse.json(
      { ok: true },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
