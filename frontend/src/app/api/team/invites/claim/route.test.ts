import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware/rate-limit-by-ip', () => ({
  inviteClaimIpLimiter: { check: vi.fn(async () => null) },
}));
vi.mock('@/lib/server/auth', () => ({
  createAccessToken: vi.fn(async () => 'access'),
  createRefreshToken: vi.fn(async () => 'refresh'),
  setAuthCookies: vi.fn(async () => {}),
  setCsrfCookie: vi.fn(async () => 'csrf-123'),
}));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));
const claimInviteWithNewAccount = vi.fn();
vi.mock('@/lib/server/team/claim', () => ({
  claimInviteWithNewAccount: (...a: unknown[]) => claimInviteWithNewAccount(...(a as [])),
}));

import { setAuthCookies } from '@/lib/server/auth';
import { POST } from './route';

function req(body: unknown) {
  return new NextRequest('http://test/api/team/invites/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/team/invites/claim', () => {
  it('400s on a bad body', async () => {
    expect((await POST(req({ token: 'short' }))).status).toBe(400);
  });

  it('maps ACCOUNT_EXISTS to 409 and issues no cookies', async () => {
    claimInviteWithNewAccount.mockResolvedValueOnce({ ok: false, code: 'ACCOUNT_EXISTS' });
    const res = await POST(req({ token: 'abcdefghij', password: 'x'.repeat(12) }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ACCOUNT_EXISTS');
    expect(setAuthCookies).not.toHaveBeenCalled();
  });

  it('maps PASSWORD_TOO_SHORT to 400', async () => {
    claimInviteWithNewAccount.mockResolvedValueOnce({ ok: false, code: 'PASSWORD_TOO_SHORT' });
    expect((await POST(req({ token: 'abcdefghij', password: 'short' }))).status).toBe(400);
  });

  it('signs the new user in on success', async () => {
    claimInviteWithNewAccount.mockResolvedValueOnce({
      ok: true,
      userId: 'u1',
      email: 'b@x.com',
      tokenVersion: 0,
      role: 'MEMBER',
    });
    const res = await POST(req({ token: 'abcdefghij', password: 'x'.repeat(12) }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, role: 'MEMBER', csrfToken: 'csrf-123' });
    expect(setAuthCookies).toHaveBeenCalledWith('access', 'refresh');
  });
});
