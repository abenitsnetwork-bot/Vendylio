import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn(), requireOrgRole: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { requireAuth, requireOrgRole } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockOrgRole = vi.mocked(requireOrgRole);
const mockStore = vi.mocked(resolveOwnStore);

const request = new NextRequest('http://test/api/team', { method: 'GET' });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { sub: 'u1', email: 'me@x.com' } });
  mockStore.mockResolvedValue({ id: 's1', organizationId: 'org1', plan: 'PRO' } as never);
  mockOrgRole.mockResolvedValue({
    user: { sub: 'u1', email: 'me@x.com' },
    orgMember: { organizationId: 'org1', userId: 'u1', role: 'MEMBER' },
  } as never);
  prismaMock.organizationMember.findMany.mockResolvedValue([
    {
      id: 'm1',
      userId: 'u1',
      role: 'MEMBER',
      createdAt: new Date(),
      user: { id: 'u1', email: 'me@x.com', name: 'Me' },
    },
  ] as never);
  prismaMock.teamInvite.findMany.mockResolvedValue([] as never);
});

describe('GET /api/team', () => {
  it('404s NO_STORE', async () => {
    mockStore.mockResolvedValueOnce(null);
    expect((await GET(request)).status).toBe(404);
  });

  it('404s a non-member (requireOrgRole bails)', async () => {
    mockOrgRole.mockResolvedValueOnce(
      NextResponse.json({ error: 'Organization not found' }, { status: 404 }),
    );
    expect((await GET(request)).status).toBe(404);
  });

  it('a MEMBER sees the roster but canManage is false', async () => {
    const res = await GET(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canManage).toBe(false);
    expect(body.isOwner).toBe(false);
    expect(body.members).toHaveLength(1);
    expect(body.members[0].isYou).toBe(true);
    expect(body.teamMembersEnabled).toBe(true);
  });

  it('an OWNER gets canManage true', async () => {
    mockOrgRole.mockResolvedValueOnce({
      user: { sub: 'u1', email: 'me@x.com' },
      orgMember: { organizationId: 'org1', userId: 'u1', role: 'OWNER' },
    } as never);
    const body = await (await GET(request)).json();
    expect(body.canManage).toBe(true);
    expect(body.isOwner).toBe(true);
  });

  it('teamMembersEnabled reflects the plan', async () => {
    mockStore.mockResolvedValueOnce({ id: 's1', organizationId: 'org1', plan: 'FREE' } as never);
    const body = await (await GET(request)).json();
    expect(body.teamMembersEnabled).toBe(false);
  });
});
