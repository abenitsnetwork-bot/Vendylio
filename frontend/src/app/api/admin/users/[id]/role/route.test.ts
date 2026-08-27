// Phase 10 — backfills test coverage for PATCH /api/admin/users/[id]/role.
// This Wave 2 route shipped with no dedicated test file (only the GET
// sibling in ../route.test.ts was covered) — discovered while building the
// admin UI that exercises it. Mirrors the Wave 1/2 admin test conventions
// (admin-fixtures, mocked requireSuperadmin + rate limiter).
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedSuperadmin, seedDemotableSuperadmin } from '@/test-utils/admin-fixtures';

vi.mock('@/lib/server/middleware', () => ({
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { PATCH } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actor = seedSuperadmin({ id: 'superadmin_actor' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeReq(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/users/u1/role', {
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
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (cb) =>
    (cb as (tx: typeof prismaMock) => unknown)(prismaMock),
  );
});

describe('PATCH /api/admin/users/[id]/role', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq({ role: 'ADMIN' }, 'missing'), ctxWith('u1'));
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin (ADMIN cannot change roles)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PATCH(makeReq({ role: 'ADMIN' }), ctxWith('u1'));
    expect(res.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await PATCH(makeReq({ role: 'ADMIN' }), ctxWith('u1'));
    expect(res.status).toBe(429);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('400s VALIDATION_FAILED on an invalid role value', async () => {
    const res = await PATCH(makeReq({ role: 'SUPERUSER' }), ctxWith('u1'));
    expect(res.status).toBe(400);
  });

  it('404s USER_NOT_FOUND when the target does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null as never);
    const res = await PATCH(makeReq({ role: 'ADMIN' }), ctxWith('missing'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('USER_NOT_FOUND');
  });

  it('promotes a USER to ADMIN and logs the action with from/to metadata', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'USER' } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: 'u1', role: 'ADMIN' } as never);

    const res = await PATCH(makeReq({ role: 'ADMIN' }), ctxWith('u1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: 'u1', role: 'ADMIN' });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'ADMIN' },
      select: { id: true, role: true },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        actorId: actor.id,
        action: 'user.role_change',
        targetType: 'User',
        targetId: 'u1',
        metadata: { from: 'USER', to: 'ADMIN' },
      }),
    );
  });

  it('409s LAST_SUPERADMIN when demoting the sole remaining SUPERADMIN', async () => {
    const sole = seedSuperadmin({ id: 'only_superadmin' });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: sole.id,
      role: 'SUPERADMIN',
    } as never);
    prismaMock.user.count.mockResolvedValueOnce(1);

    const res = await PATCH(makeReq({ role: 'ADMIN' }), ctxWith(sole.id));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('LAST_SUPERADMIN');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockLogAdminAction).not.toHaveBeenCalled();
  });

  it('allows demoting a SUPERADMIN when another one remains', async () => {
    const { demotable } = seedDemotableSuperadmin();
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: demotable.id,
      role: 'SUPERADMIN',
    } as never);
    prismaMock.user.count.mockResolvedValueOnce(2); // keeper + demotable
    prismaMock.user.update.mockResolvedValueOnce({ id: demotable.id, role: 'ADMIN' } as never);

    const res = await PATCH(makeReq({ role: 'ADMIN' }), ctxWith(demotable.id));
    expect(res.status).toBe(200);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: demotable.id },
      data: { role: 'ADMIN' },
      select: { id: true, role: true },
    });
  });

  it('does not run the last-SUPERADMIN count check for a non-demoting change', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'USER' } as never);
    prismaMock.user.update.mockResolvedValueOnce({ id: 'u1', role: 'ADMIN' } as never);

    await PATCH(makeReq({ role: 'ADMIN' }), ctxWith('u1'));
    expect(prismaMock.user.count).not.toHaveBeenCalled();
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

  it('requires CSRF (verifyCsrf import present)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toContain('verifyCsrf');
  });
});
