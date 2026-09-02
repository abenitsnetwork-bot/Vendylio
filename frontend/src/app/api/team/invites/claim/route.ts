// POST /api/team/invites/claim — redeem an invite by creating a new account.
//
// For an invited teammate who has NO Vendylio account. Sets a password, marks
// the email verified (the tokened link proves address ownership — same trust
// model as password-reset), joins the org, and signs them in. A visitor who
// already has an account gets ACCOUNT_EXISTS and must use the authenticated
// /team/invites/accept path instead.
//
// CSRF carve-out: like /api/auth/signup, this is a pre-session route — no CSRF
// cookie exists yet. It's protected by a per-IP limiter instead.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  createAccessToken,
  createRefreshToken,
  setAuthCookies,
  setCsrfCookie,
} from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { claimInviteWithNewAccount, type ClaimResult } from '@/lib/server/team/claim';
import { inviteClaimIpLimiter } from '@/lib/server/middleware/rate-limit-by-ip';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

const Body = z.object({
  token: z.string().trim().min(10).max(200),
  password: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
});

type FailCode = Exclude<ClaimResult, { ok: true }>['code'];

const STATUS: Record<FailCode, number> = {
  INVITE_NOT_FOUND: 404,
  INVITE_NOT_PENDING: 409,
  INVITE_EXPIRED: 410,
  ACCOUNT_EXISTS: 409,
  PASSWORD_BANNED: 400,
  PASSWORD_TOO_SHORT: 400,
};

const MESSAGE: Record<FailCode, string> = {
  INVITE_NOT_FOUND: 'This invitation link is not valid.',
  INVITE_NOT_PENDING: 'This invitation has already been used or revoked.',
  INVITE_EXPIRED: 'This invitation has expired. Ask for a new one.',
  ACCOUNT_EXISTS: 'You already have an account. Sign in to accept the invitation.',
  PASSWORD_BANNED: 'This password is too common.',
  PASSWORD_TOO_SHORT: `Password must be at least ${Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 10)} characters.`,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const limited = await inviteClaimIpLimiter.check(req);
    if (limited) return limited;

    const headers = { 'x-request-id': ctx.requestId };
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers },
      );
    }

    const result = await claimInviteWithNewAccount(prisma, {
      token: parsed.data.token,
      password: parsed.data.password,
      name: parsed.data.name,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.code, message: MESSAGE[result.code] },
        { status: STATUS[result.code], headers },
      );
    }

    const access = await createAccessToken({
      sub: result.userId,
      email: result.email,
      tokenVersion: result.tokenVersion,
    });
    const refresh = await createRefreshToken(result.userId, result.tokenVersion);
    await setAuthCookies(access, refresh);
    const csrfToken = await setCsrfCookie();

    log.info('team invite claimed — new account', { userId: result.userId, role: result.role });

    return NextResponse.json({ ok: true, role: result.role, csrfToken }, { status: 201, headers });
  });
}
