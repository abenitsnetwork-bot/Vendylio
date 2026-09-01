import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('next/server', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, after: vi.fn((cb: () => unknown) => cb()) };
});
vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
  requireOrgRole: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
const sendInvite = vi.fn(async () => {});
vi.mock('@/lib/server/team/send-invite-now', () => ({
  sendTeamInviteNow: (...a: unknown[]) => sendInvite(...(a as [])),
}));

import { requireAuth, requireOrgRole } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { POST } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockOrgRole = vi.mocked(requireOrgRole);
const mockStore = vi.mocked(resolveOwnStore);

function req(body: unknown) {
  return new NextRequest('http://test/api/team/invites', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': 't', cookie: 'app-csrf=t' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { sub: 'owner-1', email: 'owner@x.com' } });
  mockStore.mockResolvedValue({
    id: 's1',
    organizationId: 'org1',
    name: 'Shop',
    plan: 'PRO',
  } as never);
  mockOrgRole.mockResolvedValue({
    user: { sub: 'owner-1', email: 'owner@x.com' },
    orgMember: { organizationId: 'org1', userId: 'owner-1', role: 'OWNER' },
  } as never);
  prismaMock.organizationMember.findFirst.mockResolvedValue(null);
  prismaMock.teamInvite.findFirst.mockResolvedValue(null);
  prismaMock.teamInvite.create.mockResolvedValue({
    id: 'inv1',
    email: 'new@x.com',
    role: 'MEMBER',
    status: 'PENDING',
    expiresAt: new Date(),
    createdAt: new Date(),
  } as never);
});

describe('POST /api/team/invites', () => {
  it('403s when the caller is not ADMIN+', async () => {
    mockOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'ORG_ROLE_INSUFFICIENT' }, { status: 403 }),
    );
    expect((await POST(req({ email: 'new@x.com', role: 'MEMBER' }))).status).toBe(403);
  });

  it('402s PLAN_UPGRADE_REQUIRED for a Free store', async () => {
    mockStore.mockResolvedValueOnce({
      id: 's1',
      organizationId: 'org1',
      name: 'Shop',
      plan: 'FREE',
    } as never);
    const res = await POST(req({ email: 'new@x.com', role: 'MEMBER' }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe('PLAN_UPGRADE_REQUIRED');
  });

  it('403s when an ADMIN tries to grant ADMIN', async () => {
    mockOrgRole.mockResolvedValueOnce({
      user: { sub: 'admin-1', email: 'a@x.com' },
      orgMember: { organizationId: 'org1', userId: 'admin-1', role: 'ADMIN' },
    } as never);
    const res = await POST(req({ email: 'new@x.com', role: 'ADMIN' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('ROLE_NOT_ALLOWED');
  });

  it('409s when the email is already a member', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValueOnce({ id: 'm1' } as never);
    const res = await POST(req({ email: 'new@x.com', role: 'MEMBER' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ALREADY_MEMBER');
  });

  it('409s when a pending invite already exists', async () => {
    prismaMock.teamInvite.findFirst.mockResolvedValueOnce({ id: 'inv0' } as never);
    const res = await POST(req({ email: 'new@x.com', role: 'MEMBER' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('INVITE_PENDING');
  });

  it('creates the invite + returns an inviteUrl + fires the email', async () => {
    const res = await POST(req({ email: 'New@x.com', role: 'MEMBER' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.inviteUrl).toContain('/team/accept?token=');
    expect(prismaMock.teamInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org1',
          email: 'new@x.com',
          role: 'MEMBER',
        }),
      }),
    );
    expect(sendInvite).toHaveBeenCalledTimes(1);
  });
});
