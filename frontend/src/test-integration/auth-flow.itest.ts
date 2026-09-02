// C1 scenario 3 — the real signup → verify-email flow against a real database.
//
// Proves the auth path end to end: a User + VerificationCode row are written in
// the signup transaction, and POST /api/auth/verify-email consumes the code,
// stamps emailVerifiedAt, and issues the three auth cookies. The verification
// code is read back straight from the DB (this suite owns the database).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import { POST as signupPOST } from '@/app/api/auth/signup/route';
import { POST as verifyPOST } from '@/app/api/auth/verify-email/route';
import { COOKIE_NAME, REFRESH_COOKIE_NAME, CSRF_COOKIE_NAME } from '@/lib/server/auth';
import { prisma, truncate, disconnect, resetCookieJar, apiRequest, cookieJar } from './harness';

beforeAll(async () => {
  await truncate();
});
afterAll(async () => {
  await disconnect();
});
beforeEach(async () => {
  await truncate();
  resetCookieJar();
});

describe('C1 — signup + verify-email', () => {
  it('creates the user + code, then verifies and issues session cookies', async () => {
    const email = `newseller-${Date.now()}@itest.dev`;

    const signup = await signupPOST(
      apiRequest('/api/auth/signup', {
        body: { email, password: 'correct-horse-battery-staple' },
      }),
    );
    expect(signup.status).toBe(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();

    const codeRow = await prisma.verificationCode.findFirstOrThrow({
      where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null },
    });

    const verify = await verifyPOST(
      apiRequest('/api/auth/verify-email', { body: { email, code: codeRow.code } }),
    );
    expect(verify.status).toBe(200);

    const jar = cookieJar();
    expect(jar.get(COOKIE_NAME)?.value).toBeTruthy();
    expect(jar.get(REFRESH_COOKIE_NAME)?.value).toBeTruthy();
    expect(jar.get(CSRF_COOKIE_NAME)?.value).toBeTruthy();

    const verified = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(verified.emailVerifiedAt).toBeInstanceOf(Date);

    const consumed = await prisma.verificationCode.findUniqueOrThrow({ where: { id: codeRow.id } });
    expect(consumed.usedAt).toBeInstanceOf(Date);
  });

  it('rejects a second use of the same code', async () => {
    const email = `newseller2-${Date.now()}@itest.dev`;
    await signupPOST(
      apiRequest('/api/auth/signup', {
        body: { email, password: 'correct-horse-battery-staple' },
      }),
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const codeRow = await prisma.verificationCode.findFirstOrThrow({
      where: { userId: user.id, type: 'EMAIL_VERIFY' },
    });

    const first = await verifyPOST(
      apiRequest('/api/auth/verify-email', { body: { email, code: codeRow.code } }),
    );
    expect(first.status).toBe(200);

    resetCookieJar();
    const second = await verifyPOST(
      apiRequest('/api/auth/verify-email', { body: { email, code: codeRow.code } }),
    );
    expect(second.status).toBe(400);
  });
});
