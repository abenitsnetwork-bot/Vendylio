import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireAdmin, requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { PATCH, DELETE } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const adminCtx = {
  user: { sub: 'admin_1', email: 'admin@test.local' },
  admin: { id: 'admin_1', email: 'admin@test.local', role: 'ADMIN' as const },
};
const superadminCtx = {
  user: { sub: 'superadmin_1', email: 'superadmin@test.local' },
  admin: { id: 'superadmin_1', email: 'superadmin@test.local', role: 'SUPERADMIN' as const },
};

function makeReq(
  method: 'PATCH' | 'DELETE',
  body?: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/stores/s1', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function ctxWith(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRequireSuperadmin.mockResolvedValue(superadminCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('PATCH /api/admin/stores/[id]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq('PATCH', { published: false }, 'missing'), ctxWith('s1'));
    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PATCH(makeReq('PATCH', { published: false }), ctxWith('s1'));
    expect(res.status).toBe(403);
  });

  it('400s VALIDATION_FAILED on a non-boolean published value', async () => {
    const res = await PATCH(makeReq('PATCH', { published: 'nope' }), ctxWith('s1'));
    expect(res.status).toBe(400);
  });

  it('404s STORE_NOT_FOUND when the store does not exist', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(makeReq('PATCH', { published: false }), ctxWith('missing'));
    expect(res.status).toBe(404);
  });

  it('is idempotent — same published value is a 200 no-op with no AdminAction', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({ id: 's1', published: true } as never);
    const res = await PATCH(makeReq('PATCH', { published: true }), ctxWith('s1'));
    expect(res.status).toBe(200);
    expect(prismaMock.store.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('unpublishes a store and logs store.unpublish', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({ id: 's1', published: true } as never);
    prismaMock.store.update.mockResolvedValueOnce({ id: 's1', published: false } as never);

    const res = await PATCH(makeReq('PATCH', { published: false }), ctxWith('s1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store).toEqual({ id: 's1', published: false });

    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { published: false },
      select: { id: true, published: true },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: adminCtx.admin.id,
        action: 'store.unpublish',
        targetType: 'Store',
        targetId: 's1',
        metadata: { from: true, to: false },
      }),
    );
  });

  it('republishes a store and logs store.publish', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({ id: 's1', published: false } as never);
    prismaMock.store.update.mockResolvedValueOnce({ id: 's1', published: true } as never);

    await PATCH(makeReq('PATCH', { published: true }), ctxWith('s1'));
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'store.publish' }),
    );
  });
});

describe('DELETE /api/admin/stores/[id]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await DELETE(makeReq('DELETE', undefined, 'missing'), ctxWith('s1'));
    expect(res.status).toBe(403);
  });

  it('propagates 403 from requireSuperadmin (ADMIN cannot delete a store)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'SUPERADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await DELETE(makeReq('DELETE'), ctxWith('s1'));
    expect(res.status).toBe(403);
  });

  it('404s STORE_NOT_FOUND when the store does not exist', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce(null);
    const res = await DELETE(makeReq('DELETE'), ctxWith('missing'));
    expect(res.status).toBe(404);
  });

  it('409s STORE_HAS_ORDERS when the store has order history (pre-check)', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      id: 's1',
      slug: 'demo-store',
      name: 'Demo Store',
      organizationId: 'org1',
    } as never);
    prismaMock.order.count.mockResolvedValueOnce(3);

    const res = await DELETE(makeReq('DELETE'), ctxWith('s1'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('STORE_HAS_ORDERS');
    expect(prismaMock.organization.delete).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('deletes via the Organization (cascade) and logs store.delete', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      id: 's1',
      slug: 'demo-store',
      name: 'Demo Store',
      organizationId: 'org1',
    } as never);
    prismaMock.order.count.mockResolvedValueOnce(0);
    prismaMock.organization.delete.mockResolvedValueOnce({ id: 'org1' } as never);

    const res = await DELETE(makeReq('DELETE'), ctxWith('s1'));
    expect(res.status).toBe(200);
    expect(prismaMock.organization.delete).toHaveBeenCalledWith({ where: { id: 'org1' } });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: superadminCtx.admin.id,
        action: 'store.delete',
        targetType: 'Store',
        targetId: 's1',
        metadata: { slug: 'demo-store', name: 'Demo Store' },
      }),
    );
  });

  it('409s STORE_HAS_ORDERS on a race-condition P2003 from the delete itself (no false AdminAction)', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      id: 's1',
      slug: 'demo-store',
      name: 'Demo Store',
      organizationId: 'org1',
    } as never);
    prismaMock.order.count.mockResolvedValueOnce(0);
    prismaMock.organization.delete.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('FK violation', {
        code: 'P2003',
        clientVersion: '5.22.0',
      }),
    );

    const res = await DELETE(makeReq('DELETE'), ctxWith('s1'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('STORE_HAS_ORDERS');
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs', withRequestContext and verifyCsrf", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
    expect(src).toContain('verifyCsrf');
  });
});
