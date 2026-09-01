// POST /api/team/invites/accept — redeem a team-invite token.
//
// Phase 4a. Requires a signed-in user whose email matches the invite. On
// success the user gets an OrganizationMember row and `resolveOwnStore` now
// resolves that store for them. A user who already belongs to an org can't
// join another (one membership per user — `resolveOwnStore` assumes it).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { acceptInvite, type AcceptResult } from '@/lib/server/team/invites';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({ token: z.string().trim().min(10).max(200) });

const STATUS: Record<Exclude<AcceptResult, { ok: true }>['code'], number> = {
  INVITE_NOT_FOUND: 404,
  INVITE_NOT_PENDING: 409,
  INVITE_EXPIRED: 410,
  EMAIL_MISMATCH: 403,
  ALREADY_IN_ORG: 409,
};

const MESSAGE: Record<Exclude<AcceptResult, { ok: true }>['code'], string> = {
  INVITE_NOT_FOUND: 'This invitation link is not valid.',
  INVITE_NOT_PENDING: 'This invitation has already been used or revoked.',
  INVITE_EXPIRED: 'This invitation has expired. Ask for a new one.',
  EMAIL_MISMATCH: 'This invitation was sent to a different email address.',
  ALREADY_IN_ORG: 'Your account already belongs to a store. Leave it first to join another.',
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const result = await acceptInvite(prisma, {
      token: parsed.data.token,
      userId: auth.user.sub,
      userEmail: auth.user.email,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.code, message: MESSAGE[result.code] },
        { status: STATUS[result.code], headers: { 'x-request-id': ctx.requestId } },
      );
    }

    return NextResponse.json(
      { ok: true, role: result.role },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
