// POST /api/admin/users/[id]/resend-verification
//
// Support action: a customer whose account exists but was never verified
// can't get a code (they hammered signup and hit the per-email rate limit,
// or don't know "resend" is the right door). An ADMIN clicks one button:
//   1. clears the signup + resend per-email rate-limit counters,
//   2. mints a fresh EMAIL_VERIFY code + outbox row,
//   3. delivers it immediately (after()), same path as a normal signup,
//   4. writes an AdminAction.
// 409 ALREADY_VERIFIED if the account is already verified — nothing to do.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, after, type NextRequest } from 'next/server';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { AUTH_LIMIT_BUCKETS, resetEmailLimit } from '@/lib/server/middleware/rate-limit-by-email';
import { generateVerificationCode } from '@/lib/server/auth';
import { enqueueOutbox } from '@/lib/server/outbox';
import { sendVerificationCodeNow } from '@/lib/server/auth/send-verification-now';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const VERIFICATION_TTL_MS = Number(process.env.AUTH_VERIFICATION_TTL_MIN ?? 15) * 60 * 1000;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, emailVerifiedAt: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'User not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    if (user.emailVerifiedAt) {
      return NextResponse.json(
        { error: 'ALREADY_VERIFIED', message: 'This account is already verified.' },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // Clear whatever rate-limit counters are pinning this email.
    await Promise.all([
      resetEmailLimit(redis, AUTH_LIMIT_BUCKETS.signup, user.email),
      resetEmailLimit(redis, AUTH_LIMIT_BUCKETS.resend, user.email),
    ]);

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    await prisma.$transaction(async (tx) => {
      await tx.verificationCode.create({
        data: { userId: user.id, code, type: 'EMAIL_VERIFY', expiresAt },
      });
      await enqueueOutbox(tx, {
        kind: 'email.verification_code',
        payload: { to: user.email, code, expiresAt: expiresAt.toISOString() },
      });
      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: 'user.resend_verification',
        targetType: 'User',
        targetId: user.id,
        metadata: { email: user.email },
      });
    });

    after(() => sendVerificationCodeNow({ to: user.email, code, expiresAt }));

    return NextResponse.json(
      { ok: true, email: user.email },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
