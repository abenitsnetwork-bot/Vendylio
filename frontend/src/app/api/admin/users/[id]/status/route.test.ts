// Phase 10 — backfills test coverage for PATCH /api/admin/users/[id]/status.
// Discovered missing while building the admin UI that exercises it — see
// the sibling role/route.test.ts header comment for context.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedAdmin, seedSuperadmin } from '@/test-utils/admin-fixtures';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { PATCH } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const admin = seedAdmin({ id: 'admin_actor' });
const adminCtx = {
  user: { sub: admin.id, email: admin.email },
  admin: { id: admin.id, email: admin.email, role: 'ADMIN' as const },
};
const superadmin = seedSuperadmin({ id: 'superadmin_actor' });
const superadminCtx = {
  user: { sub: superadmin.id, email: superadmin.email },
  admin: { id: superadmin.id, email: superadmin.email, role: 'SUPERADMIN' as const },
};

function makeReq(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/users/u1/status', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

function ctxWith(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (cb) =>
    (cb as (tx: typeof prismaMock) => unknown)(prismaMock),
  );
});

describe('PATCH /api/admin/users/[id]/status', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq({ status: 'SUSPENDED' }, 'missing'), ctxWith('u1'));
    expect(res.status).toBe(403);
    expect(mockRequireAdmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PATCH(makeReq({ status: 'SUSPENDED' }), ctxWith('u1'));
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await PATCH(makeReq({ status: 'SUSPENDED' }), ctxWith('u1'));
    expect(res.status).toBe(429);
  });

  it('400s on invalid body', async () => {
    const res = await PATCH(makeReq({ status: 'BANNED' }), ctxWith('u1'));
    expect(res.status).toBe(400);
  });

  it('404s USER_NOT_FOUND when the target does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never);
    const res = await PATCH(makeReq({ status: 'SUSPENDED' }), ctxWith('missing'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('USER_NOT_FOUND');
  });

  it('is idempotent on same-status PATCH and writes no AdminAction', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      status: 'ACTIVE',
      email: 'u1@test.local',
      name: null,
      role: 'USER',
    } as never);

    const res = await PATCH(makeReq({ status: 'ACTIVE' }), ctxWith('u1'));
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('ADMIN can suspend a plain USER and it is logged', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      status: 'ACTIVE',
      email: 'u1@test.local',
      name: null,
      role: 'USER',
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: 'u1', status: 'SUSPENDED' } as never);

    const res = await PATCH(
      makeReq({ status: 'SUSPENDED', reason: 'ToS violation' }),
      ctxWith('u1'),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { status: 'SUSPENDED' },
      select: { id: true, status: true },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        action: 'user.suspend',
        metadata: { from: 'ACTIVE', to: 'SUSPENDED', reason: 'ToS violation' },
      }),
    );
  });

  it('403s RESTORE_REQUIRES_SUPERADMIN when an ADMIN tries to restore a suspended user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      status: 'SUSPENDED',
      email: 'u1@test.local',
      name: null,
      role: 'USER',
    } as never);

    const res = await PATCH(makeReq({ status: 'ACTIVE' }), ctxWith('u1'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('RESTORE_REQUIRES_SUPERADMIN');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('SUPERADMIN can restore a suspended user', async () => {
    mockRequireAdmin.mockResolvedValueOnce(superadminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      status: 'SUSPENDED',
      email: 'u1@test.local',
      name: null,
      role: 'USER',
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: 'u1', status: 'ACTIVE' } as never);

    const res = await PATCH(makeReq({ status: 'ACTIVE' }), ctxWith('u1'));
    expect(res.status).toBe(200);
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ action: 'user.restore' }),
    );
  });

  it('403s SUSPEND_REQUIRES_SUPERADMIN when an ADMIN tries to suspend a SUPERADMIN', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u2',
      status: 'ACTIVE',
      email: 'super@test.local',
      name: null,
      role: 'SUPERADMIN',
    } as never);

    const res = await PATCH(makeReq({ status: 'SUSPENDED', reason: 'x' }), ctxWith('u2'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('SUSPEND_REQUIRES_SUPERADMIN');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('SUPERADMIN can suspend another SUPERADMIN', async () => {
    mockRequireAdmin.mockResolvedValueOnce(superadminCtx);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u2',
      status: 'ACTIVE',
      email: 'super@test.local',
      name: null,
      role: 'SUPERADMIN',
    } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: 'u2', status: 'SUSPENDED' } as never);

    const res = await PATCH(makeReq({ status: 'SUSPENDED', reason: 'x' }), ctxWith('u2'));
    expect(res.status).toBe(200);
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
