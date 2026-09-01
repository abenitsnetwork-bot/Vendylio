// POST /api/business-waitlist — capture interest in the (unbuilt) "Business"
// tier from the /pricing teaser.
//
// Phase 5. Public + guest-safe: per-IP throttle before the body parse,
// guest CSRF (any header passes for a true guest). Idempotent on email — a
// repeat submit returns 200 without erroring. Read via Prisma Studio; no
// admin view in v1.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { leadIpLimiter } from '@/lib/server/middleware/rate-limit-by-ip';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  storeName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const rl = await leadIpLimiter.check(req);
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

    try {
      await prisma.businessLead.create({
        data: {
          email: parsed.data.email,
          ...(parsed.data.storeName ? { storeName: parsed.data.storeName } : {}),
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        },
      });
      return NextResponse.json(
        { ok: true },
        { status: 201, headers: { 'x-request-id': ctx.requestId } },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already on the list — treat as success.
        return NextResponse.json(
          { ok: true, alreadyListed: true },
          { headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw err;
    }
  });
}
