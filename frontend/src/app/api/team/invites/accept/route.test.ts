import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));
const acceptInvite = vi.fn();
vi.mock('@/lib/server/team/invites', () => ({
  acceptInvite: (...a: unknown[]) => acceptInvite(...(a as [])),
}));

import { requireAuth } from '@/lib/server/middleware';
import { POST } from './route';

const mockAuth = vi.mocked(requireAuth);

function req(body: unknown) {
  return new NextRequest('http://test/api/team/invites/accept', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': 't', cookie: 'app-csrf=t' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { sub: 'u1', email: 'new@x.com' } });
});

describe('POST /api/team/invites/accept', () => {
  it('401s when auth bails', async () => {
    mockAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await POST(req({ token: 'abcdefghij' }))).status).toBe(401);
  });

  it('400s on a missing token', async () => {
    expect((await POST(req({}))).status).toBe(400);
  });

  it('maps EMAIL_MISMATCH to 403', async () => {
    acceptInvite.mockResolvedValueOnce({ ok: false, code: 'EMAIL_MISMATCH' });
    const res = await POST(req({ token: 'abcdefghij' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('EMAIL_MISMATCH');
  });

  it('maps INVITE_EXPIRED to 410', async () => {
    acceptInvite.mockResolvedValueOnce({ ok: false, code: 'INVITE_EXPIRED' });
    expect((await POST(req({ token: 'abcdefghij' }))).status).toBe(410);
  });

  it('returns the role on success', async () => {
    acceptInvite.mockResolvedValueOnce({ ok: true, organizationId: 'org1', role: 'MEMBER' });
    const res = await POST(req({ token: 'abcdefghij' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: 'MEMBER' });
  });
});
