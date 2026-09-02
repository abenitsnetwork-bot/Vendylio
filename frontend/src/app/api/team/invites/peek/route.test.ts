import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware/rate-limit-by-ip', () => ({
  invitePeekIpLimiter: { check: vi.fn(async () => null) },
}));
const { teamInvite, user } = vi.hoisted(() => ({
  teamInvite: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('@/lib/server/prisma', () => ({ prisma: { teamInvite, user } }));

import { GET } from './route';

function req(token?: string) {
  const url = token
    ? `http://test/api/team/invites/peek?token=${encodeURIComponent(token)}`
    : 'http://test/api/team/invites/peek';
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/team/invites/peek', () => {
  it('returns INVALID for a short/absent token without hitting the DB', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('INVALID');
    expect(teamInvite.findUnique).not.toHaveBeenCalled();
  });

  it('returns INVALID for an unknown token', async () => {
    teamInvite.findUnique.mockResolvedValueOnce(null);
    expect((await (await GET(req('abcdefghijkl'))).json()).status).toBe('INVALID');
  });

  it('returns PENDING with org + account info', async () => {
    teamInvite.findUnique.mockResolvedValueOnce({
      email: 'Bob@X.com',
      role: 'ADMIN',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      organization: { name: 'Acme' },
    });
    user.findUnique.mockResolvedValueOnce(null);
    const body = await (await GET(req('abcdefghijkl'))).json();
    expect(body).toEqual({
      status: 'PENDING',
      email: 'bob@x.com',
      role: 'ADMIN',
      orgName: 'Acme',
      hasAccount: false,
    });
  });

  it('flags EXPIRED and USED', async () => {
    teamInvite.findUnique.mockResolvedValueOnce({
      email: 'b@x.com',
      role: 'MEMBER',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1),
      organization: { name: 'Acme' },
    });
    user.findUnique.mockResolvedValue(null);
    expect((await (await GET(req('abcdefghijkl'))).json()).status).toBe('EXPIRED');

    teamInvite.findUnique.mockResolvedValueOnce({
      email: 'b@x.com',
      role: 'MEMBER',
      status: 'REVOKED',
      expiresAt: new Date(Date.now() + 60_000),
      organization: { name: 'Acme' },
    });
    expect((await (await GET(req('abcdefghijkl'))).json()).status).toBe('USED');
  });
});
