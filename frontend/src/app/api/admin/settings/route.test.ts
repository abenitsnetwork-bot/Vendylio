import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedSuperadmin } from '@/test-utils/admin-fixtures';

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
import { GET, PATCH } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/admin/settings');
}

function makePatch(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/settings', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('GET /api/admin/settings', () => {
  it('propagates 403 from requireSuperadmin (ADMIN cannot read)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
  });

  it('returns 0% / null when no row exists yet (fresh install)', async () => {
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ commissionRateBp: 0, commissionRateBpPro: null });
  });

  it('returns the stored rates', async () => {
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 600,
      commissionRateBpPro: 300,
      updatedAt: new Date(),
    } as never);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body).toEqual({ commissionRateBp: 600, commissionRateBpPro: 300 });
  });
});

describe('PATCH /api/admin/settings', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(
      makePatch({ commissionRateBp: 600, commissionRateBpPro: null }, 'missing'),
    );
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin (ADMIN cannot write)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PATCH(makePatch({ commissionRateBp: 600, commissionRateBpPro: null }));
    expect(res.status).toBe(403);
  });

  it.each([
    { commissionRateBp: -1, commissionRateBpPro: null },
    { commissionRateBp: 10_001, commissionRateBpPro: null },
    { commissionRateBp: 600, commissionRateBpPro: -1 },
    { commissionRateBp: 1.5, commissionRateBpPro: null },
  ])('400s VALIDATION_FAILED for out-of-range/non-integer input %j', async (body) => {
    const res = await PATCH(makePatch(body));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('VALIDATION_FAILED');
  });

  it('upserts the singleton row and logs the change with before/after values', async () => {
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 0,
      commissionRateBpPro: null,
      updatedAt: new Date(),
    } as never);
    prismaMock.platformSettings.upsert.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 600,
      commissionRateBpPro: 300,
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(makePatch({ commissionRateBp: 600, commissionRateBpPro: 300 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ commissionRateBp: 600, commissionRateBpPro: 300 });

    expect(prismaMock.platformSettings.upsert).toHaveBeenCalledWith({
      where: { id: 'default' },
      create: { id: 'default', commissionRateBp: 600, commissionRateBpPro: 300 },
      update: { commissionRateBp: 600, commissionRateBpPro: 300 },
    });

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        actorId: actor.id,
        action: 'settings.commission_rate_change',
        targetType: 'PlatformSettings',
        targetId: 'default',
        metadata: expect.objectContaining({
          previousCommissionRateBp: 0,
          previousCommissionRateBpPro: null,
          newCommissionRateBp: 600,
          newCommissionRateBpPro: 300,
        }),
      }),
    );
  });

  it('accepts null commissionRateBpPro to clear the PRO discount', async () => {
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 600,
      commissionRateBpPro: 300,
      updatedAt: new Date(),
    } as never);
    prismaMock.platformSettings.upsert.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 600,
      commissionRateBpPro: null,
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(makePatch({ commissionRateBp: 600, commissionRateBpPro: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commissionRateBpPro).toBeNull();
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
