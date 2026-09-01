import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/auth', () => ({ verifyCsrf: vi.fn(() => null) }));
vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn(), requireOrgRole: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { requireAuth, requireOrgRole } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { PATCH, DELETE } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockOrgRole = vi.mocked(requireOrgRole);
const mockStore = vi.mocked(resolveOwnStore);

function req(method: 'PATCH' | 'DELETE', body?: unknown) {
  return new NextRequest('http://test/api/team/members/m2', {
    method,
    headers: { 'content-type': 'application/json', 'x-csrf-token': 't', cookie: 'app-csrf=t' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = { params: Promise.resolve({ id: 'm2' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { sub: 'owner-1', email: 'o@x.com' } });
  mockStore.mockResolvedValue({ id: 's1', organizationId: 'org1' } as never);
  mockOrgRole.mockResolvedValue({
    user: { sub: 'owner-1', email: 'o@x.com' },
    orgMember: { organizationId: 'org1', userId: 'owner-1', role: 'OWNER' },
  } as never);
  prismaMock.organizationMember.findUnique.mockResolvedValue({
    id: 'm2',
    organizationId: 'org1',
    role: 'MEMBER',
    userId: 'u2',
  } as never);
  prismaMock.organizationMember.update.mockResolvedValue({
    id: 'm2',
    role: 'ADMIN',
    userId: 'u2',
  } as never);
  prismaMock.organizationMember.delete.mockResolvedValue({ id: 'm2' } as never);
});

describe('PATCH /api/team/members/[id]', () => {
  it('403s a non-owner', async () => {
    mockOrgRole.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 403 }));
    expect((await PATCH(req('PATCH', { role: 'ADMIN' }), params)).status).toBe(403);
  });

  it('refuses to change the OWNER', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({
      id: 'm2',
      organizationId: 'org1',
      role: 'OWNER',
      userId: 'u2',
    } as never);
    const res = await PATCH(req('PATCH', { role: 'MEMBER' }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('CANNOT_CHANGE_OWNER');
  });

  it('updates a member role', async () => {
    const res = await PATCH(req('PATCH', { role: 'ADMIN' }), params);
    expect(res.status).toBe(200);
    expect(prismaMock.organizationMember.update).toHaveBeenCalledWith({
      where: { id: 'm2' },
      data: { role: 'ADMIN' },
      select: { id: true, role: true, userId: true },
    });
  });

  it('404s a member from another org', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({
      id: 'm2',
      organizationId: 'other',
      role: 'MEMBER',
      userId: 'u2',
    } as never);
    expect((await PATCH(req('PATCH', { role: 'ADMIN' }), params)).status).toBe(404);
  });
});

describe('DELETE /api/team/members/[id]', () => {
  it('lets the OWNER remove a member', async () => {
    const res = await DELETE(req('DELETE'), params);
    expect(res.status).toBe(200);
    expect(prismaMock.organizationMember.delete).toHaveBeenCalledWith({ where: { id: 'm2' } });
  });

  it('lets a member remove themselves (self-leave)', async () => {
    mockAuth.mockResolvedValue({ user: { sub: 'u2', email: 'u2@x.com' } });
    mockOrgRole.mockResolvedValue({
      user: { sub: 'u2', email: 'u2@x.com' },
      orgMember: { organizationId: 'org1', userId: 'u2', role: 'MEMBER' },
    } as never);
    const res = await DELETE(req('DELETE'), params);
    expect(res.status).toBe(200);
    expect((await res.json()).leftOrg).toBe(true);
  });

  it('403s a non-owner removing someone else', async () => {
    mockAuth.mockResolvedValue({ user: { sub: 'u3', email: 'u3@x.com' } });
    mockOrgRole.mockResolvedValue({
      user: { sub: 'u3', email: 'u3@x.com' },
      orgMember: { organizationId: 'org1', userId: 'u3', role: 'ADMIN' },
    } as never);
    const res = await DELETE(req('DELETE'), params);
    expect(res.status).toBe(403);
  });

  it('refuses to remove the OWNER', async () => {
    prismaMock.organizationMember.findUnique.mockResolvedValueOnce({
      id: 'm2',
      organizationId: 'org1',
      role: 'OWNER',
      userId: 'u2',
    } as never);
    expect((await DELETE(req('DELETE'), params)).status).toBe(409);
  });
});
