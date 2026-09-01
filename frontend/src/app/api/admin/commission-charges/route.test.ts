// Phase 1b — admin commission receivables (GET) + SUPERADMIN waive (POST).
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return { ...actual, verifyCsrf: vi.fn() };
});
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn().mockResolvedValue(undefined),
}));

import { requireAdmin, requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { verifyCsrf } from '@/lib/server/auth';
import { logAdminAction } from '@/lib/server/admin/audit';
import { seedAdmin, seedSuperadmin } from '@/test-utils/admin-fixtures';
import { GET } from './route';
import { POST as WAIVE } from './waive/route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockVerifyCsrf = vi.mocked(verifyCsrf);
const mockLog = vi.mocked(logAdminAction);

const adminUser = seedAdmin({ id: 'admin_1', email: 'a@test.local' });
const adminCtx = {
  user: { sub: adminUser.id, email: adminUser.email },
  admin: { id: adminUser.id, email: adminUser.email, role: 'ADMIN' as const },
};
const superUser = seedSuperadmin({ id: 'super_1', email: 's@test.local' });
const superCtx = {
  user: { sub: superUser.id, email: superUser.email },
  admin: { id: superUser.id, email: superUser.email, role: 'SUPERADMIN' as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx as never);
  mockRequireSuperadmin.mockResolvedValue(superCtx as never);
  mockRateLimit.mockResolvedValue(undefined as never);
  mockVerifyCsrf.mockReturnValue(null as never);
});

describe('GET /api/admin/commission-charges', () => {
  it('aggregates OWED + INVOICED by store, sorted by owed desc', async () => {
    (prismaMock.commissionCharge.groupBy as unknown as Mock).mockResolvedValueOnce([
      {
        storeId: 's1',
        status: 'OWED',
        _sum: { amountCents: 900 },
        _count: { _all: 3 },
        _min: { createdAt: new Date('2026-08-01') },
      },
      {
        storeId: 's2',
        status: 'OWED',
        _sum: { amountCents: 5000 },
        _count: { _all: 2 },
        _min: { createdAt: new Date('2026-08-20') },
      },
      {
        storeId: 's2',
        status: 'INVOICED',
        _sum: { amountCents: 1200 },
        _count: { _all: 1 },
        _min: { createdAt: new Date('2026-08-10') },
      },
    ] as never);
    prismaMock.store.findMany.mockResolvedValueOnce([
      { id: 's1', name: 'Alpha', slug: 'alpha' },
      { id: 's2', name: 'Beta', slug: 'beta' },
    ] as never);

    const res = await GET(new NextRequest('http://t/api/admin/commission-charges'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals).toEqual({ owedCents: 5900, invoicedCents: 1200, storeCount: 2 });
    expect(body.stores[0].storeId).toBe('s2');
    expect(body.stores[0]).toMatchObject({ owedCents: 5000, invoicedCents: 1200, chargeCount: 3 });
    expect(body.stores[1]).toMatchObject({ storeName: 'Alpha', owedCents: 900 });
  });

  it('401s a non-admin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'x' }, { status: 401 }) as never,
    );
    const res = await GET(new NextRequest('http://t/api/admin/commission-charges'));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/commission-charges/waive', () => {
  function req(body: unknown) {
    return new NextRequest('http://t/api/admin/commission-charges/waive', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'x' },
      body: JSON.stringify(body),
    });
  }

  it('waives every OWED row for the store + audits it', async () => {
    prismaMock.commissionCharge.findMany.mockResolvedValueOnce([
      { id: 'c1', amountCents: 300 },
      { id: 'c2', amountCents: 200 },
    ] as never);
    (prismaMock.$transaction as unknown as Mock).mockImplementationOnce(
      (fn: (tx: unknown) => unknown) =>
        fn({ commissionCharge: { updateMany: vi.fn(async () => ({ count: 2 })) } }),
    );

    const res = await WAIVE(req({ storeId: 's1', reason: 'pilot goodwill' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, chargeCount: 2, centsWaived: 500 });
    expect(mockLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'commission.waive', targetId: 's1' }),
    );
  });

  it('409 NOTHING_OWED when the store has no OWED rows', async () => {
    prismaMock.commissionCharge.findMany.mockResolvedValueOnce([] as never);
    const res = await WAIVE(req({ storeId: 's1', reason: 'x' }));
    expect(res.status).toBe(409);
  });

  it('403 for a non-superadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'x' }, { status: 403 }) as never,
    );
    const res = await WAIVE(req({ storeId: 's1', reason: 'x' }));
    expect(res.status).toBe(403);
  });

  it('403 without CSRF', async () => {
    mockVerifyCsrf.mockReturnValueOnce(NextResponse.json({ error: 'x' }, { status: 403 }) as never);
    const res = await WAIVE(req({ storeId: 's1', reason: 'x' }));
    expect(res.status).toBe(403);
  });
});
