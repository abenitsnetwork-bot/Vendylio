// AUTH-01 — POST /api/auth/signup
//
// Enumeration-resistant: returns identical 201 { ok: true } whether the email
// is new or already exists (D-22). Genuinely new users get a User row, an
// EMAIL_VERIFY VerificationCode, and an outbox email event — all in one tx.
// Existing-email branch runs `dummyBcryptCompare` so the request takes
// ~the same time as the new-user branch (timing parity).
//
// CSRF carve-out: signup is a pre-session route — no CSRF cookie exists yet,
// so calling verifyCsrf would 403 every legitimate request. The CSRF cookie is
// set on session establishment (verify-email / login / refresh).
export const runtime = 'nodejs';

import { NextResponse, after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { zEmail } from '@/lib/server/zod-helpers';
import { prisma } from '@/lib/server/prisma';
import { redis } from '@/lib/server/redis';
import { createEmailLimiter } from '@/lib/server/middleware/rate-limit-by-email';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';
import { hashPassword, generateVerificationCode } from '@/lib/server/auth';
import { isBanned } from '@/lib/server/auth/banned-passwords';
import { isPwned } from '@/lib/server/auth/hibp';
import { dummyBcryptCompare } from '@/lib/server/auth/dummy-bcrypt';
import { enqueueOutbox } from '@/lib/server/outbox';
import { sendVerificationCodeNow } from '@/lib/server/auth/send-verification-now';

const PASSWORD_MIN = Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 10);
const VERIFICATION_TTL_MS = Number(process.env.AUTH_VERIFICATION_TTL_MIN ?? 15) * 60 * 1000;

const Body = z.object({
  email: zEmail,
  password: z.string().min(1),
  // Optional display name (e.g. from a richer registration form). Purely
  // cosmetic — signup succeeds identically with or without it.
  name: z.string().trim().min(1).max(120).optional(),
});

const limiter = createEmailLimiter(redis ? { redis } : {}, {
  bucket: 'auth:signup',
  windowMs: 60 * 60 * 1000, // 1 hour (D-08)
  max: Number(process.env.AUTH_SIGNUP_RATE_LIMIT_MAX ?? 5),
  code: 'TOO_MANY_SIGNUP_ATTEMPTS',
  message: 'Too many signup attempts. Try again later.',
});

function formatIssues(err: z.ZodError) {
  return err.issues.map((e) => ({ path: e.path.join('.'), message: e.message }));
}

export async function POST(req: NextRequest): Promise<Response> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // 1. Body parse + Zod validation.
    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      const res = NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: formatIssues(parsed.error) },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }
    const { email, password, name } = parsed.data;

    // 2. Password policy gates BEFORE looking up user (D-22 — keep the no-user
    //    and existing-user branches symmetric below).
    //    Banned check runs before length so a common short password ("password")
    //    surfaces the more specific PASSWORD_BANNED code rather than TOO_SHORT.
    if (isBanned(password)) {
      const res = NextResponse.json(
        { error: 'PASSWORD_BANNED', message: 'This password is too common.' },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }
    if (password.length < PASSWORD_MIN) {
      const res = NextResponse.json(
        {
          error: 'PASSWORD_TOO_SHORT',
          message: `Password must be at least ${PASSWORD_MIN} characters`,
        },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }
    if (process.env.PASSWORD_HIBP_CHECK === '1' && (await isPwned(password))) {
      const res = NextResponse.json(
        {
          error: 'PASSWORD_PWNED',
          message: 'This password appeared in a known data breach.',
        },
        { status: 400 },
      );
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }

    // 3. Per-email rate limit.
    const rateFail = await limiter.check(req, email);
    if (rateFail) return rateFail;

    // 4. Existing-email branch — return identical 201 with timing parity (D-22).
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, emailVerifiedAt: true },
    });
    if (existing) {
      await dummyBcryptCompare(password);
      // If the account exists but was never verified, someone re-running
      // signup almost certainly just wants their code again (they have no
      // way to know "resend" is the right door). Re-issue + send it. Still
      // enumeration-safe: the response is byte-identical, the send is
      // post-response (timing parity holds), and the email only ever reaches
      // the real inbox owner — a prober learns nothing. A VERIFIED account
      // stays silent (they should log in / use forgot-password).
      if (!existing.emailVerifiedAt) {
        const code = generateVerificationCode();
        const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
        await prisma.$transaction(async (tx) => {
          await tx.verificationCode.create({
            data: { userId: existing.id, code, type: 'EMAIL_VERIFY', expiresAt },
          });
          await enqueueOutbox(tx, {
            kind: 'email.verification_code',
            payload: { to: email, code, expiresAt: expiresAt.toISOString() },
          });
        });
        after(() => sendVerificationCodeNow({ to: email, code, expiresAt }));
        log.info('signup duplicate — unverified, code re-issued');
      } else {
        log.info('signup duplicate (enumeration-resist)');
      }
      const res = NextResponse.json({ ok: true }, { status: 201 });
      res.headers.set('x-request-id', ctx.requestId);
      return res;
    }

    // 5. New-user branch — hash + create User + VerificationCode + outbox.
    const passwordHash = await hashPassword(password);
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, ...(name ? { name } : {}) },
        select: { id: true },
      });
      await tx.verificationCode.create({
        data: {
          userId: user.id,
          code,
          type: 'EMAIL_VERIFY',
          expiresAt,
        },
      });
      await enqueueOutbox(tx, {
        kind: 'email.verification_code',
        payload: {
          to: email,
          code,
          expiresAt: expiresAt.toISOString(),
        },
      });
    });

    log.info('signup new user');
    // Deliver the code now instead of waiting on the 1-min outbox cron. Runs
    // after the response is flushed — no added latency, no timing-parity leak
    // (the existing-email branch above is untouched). The outbox row is the
    // fallback if this best-effort send can't complete.
    after(() => sendVerificationCodeNow({ to: email, code, expiresAt }));
    const res = NextResponse.json({ ok: true }, { status: 201 });
    res.headers.set('x-request-id', ctx.requestId);
    return res;
  });
}
