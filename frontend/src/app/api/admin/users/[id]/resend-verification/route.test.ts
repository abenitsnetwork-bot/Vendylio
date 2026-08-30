import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedAdmin } from '@/test-utils/admin-fixtures';

vi.mock('@/lib/server/middleware', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/server/outbox', () => ({ enqueueOutbox: vi.fn() }));
vi.mock('@/lib/server/auth/send-verification-now', () => ({
  sendVerificationCodeNow: vi.fn(),
}));
const { resetEmailLimit } = vi.hoisted(() => ({ resetEmailLimit: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-email', () => ({
  AUTH_LIMIT_BUCKETS: { signup: 'auth:signup', resend: 'auth:resend', login: 'auth:login' },
  resetEmailLimit,
}));
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return { ...actual, after: (fn: () => unknown) => void fn() };
});

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enqueueOutbox } from '@/lib/server/outbox';
import { sendVerificationCodeNow } from '@/lib/server/auth/send-verification-now';
import { POST } from './route';

const admin = seedAdmin({ id: 'admin_actor' });
const adminCtx = {
  user: { sub: admin.id, email: admin.email },
  admin: { id: admin.id, email: admin.email, role: 'ADMIN' as const },
};

function makeReq(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'tok';
  return new NextRequest('http://test/api/admin/users/u1/resend-verification', {
    method: 'POST',
    headers,
  });
}
const ctxWith = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminCtx as never);
  vi.mocked(enforceAdminRateLimit).mockResolvedValue(null as never);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u1',
    email: 'Client@Gmail.com',
    emailVerifiedAt: null,
  } as never);
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
  prismaMock.verificationCode.create.mockResolvedValue({} as never);
});

describe('POST /api/admin/users/[id]/resend-verification', () => {
  it('403s without CSRF', async () => {
    expect((await POST(makeReq('missing'), ctxWith('u1'))).status).toBe(403);
  });

  it('401s when requireAdmin bails', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: 'x' }, { status: 401 }) as never,
    );
    expect((await POST(makeReq(), ctxWith('u1'))).status).toBe(401);
  });

  it('404s USER_NOT_FOUND', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq(), ctxWith('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('USER_NOT_FOUND');
  });

  it('409s ALREADY_VERIFIED when the account is verified', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'v@x.com',
      emailVerifiedAt: new Date(),
    } as never);
    const res = await POST(makeReq(), ctxWith('u1'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ALREADY_VERIFIED');
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });

  it('clears both rate-limit buckets, mints a code, audits and sends now', async () => {
    const res = await POST(makeReq(), ctxWith('u1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, email: 'Client@Gmail.com' });

    const buckets = resetEmailLimit.mock.calls.map((c) => c[1]);
    expect(buckets).toEqual(expect.arrayContaining(['auth:signup', 'auth:resend']));
    expect(resetEmailLimit.mock.calls.every((c) => c[2] === 'Client@Gmail.com')).toBe(true);

    expect(prismaMock.verificationCode.create).toHaveBeenCalledTimes(1);
    const codeArg = prismaMock.verificationCode.create.mock.calls[0]?.[0];
    expect(codeArg?.data?.type).toBe('EMAIL_VERIFY');

    expect(enqueueOutbox).toHaveBeenCalledTimes(1);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'user.resend_verification', targetId: 'u1' }),
    );
    expect(sendVerificationCodeNow).toHaveBeenCalledTimes(1);
  });
});
