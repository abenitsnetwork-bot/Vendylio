// Phase 10 — GET /api/admin/stats aggregate metrics for the admin dashboard.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const adminCtx = {
  user: { sub: 'admin_1', email: 'admin@test.local' },
  admin: { id: 'admin_1', email: 'admin@test.local', role: 'ADMIN' as const },
};

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/admin/stats', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.organization.count.mockResolvedValue(3);
  prismaMock.store.count.mockResolvedValue(2);
  prismaMock.order.count.mockResolvedValueOnce(5); // ordersToday
  prismaMock.order.aggregate.mockResolvedValueOnce({ _sum: { amount: 10000 } } as never); // gmv
  prismaMock.order.aggregate.mockResolvedValueOnce({
    _sum: { commissionAmount: 600 },
  } as never); // platform revenue
  prismaMock.delivery.count.mockResolvedValue(4);
  prismaMock.order.count.mockResolvedValueOnce(1); // failedPayments
});

describe('GET /api/admin/stats', () => {
  it('propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
    expect(prismaMock.organization.count).not.toHaveBeenCalled();
  });

  it('rate limits admin per-userId — propagates 429', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(429);
    expect(prismaMock.organization.count).not.toHaveBeenCalled();
  });

  it('returns the aggregate metrics shape', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      merchantCount: 3,
      activeStoreCount: 2,
      ordersToday: 5,
      gmvCents: 10000,
      platformRevenueCents: 600,
      activeDeliveries: 4,
      failedPayments: 1,
    });
  });

  it('scopes activeStoreCount to published stores', async () => {
    await GET(makeGet());
    expect(prismaMock.store.count).toHaveBeenCalledWith({ where: { published: true } });
  });

  it('scopes GMV and platform revenue to every paid order (PAID + fulfilled)', async () => {
    await GET(makeGet());
    const paidStatuses = { in: ['PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] };
    expect(prismaMock.order.aggregate).toHaveBeenCalledWith({
      where: { status: paidStatuses },
      _sum: { amount: true },
    });
    expect(prismaMock.order.aggregate).toHaveBeenCalledWith({
      where: { status: paidStatuses },
      _sum: { commissionAmount: true },
    });
  });

  it('scopes activeDeliveries to REQUESTED status', async () => {
    await GET(makeGet());
    expect(prismaMock.delivery.count).toHaveBeenCalledWith({ where: { status: 'REQUESTED' } });
  });

  it('defaults gmvCents/platformRevenueCents to 0 when there are no PAID orders', async () => {
    prismaMock.order.aggregate.mockReset();
    prismaMock.order.aggregate.mockResolvedValueOnce({ _sum: { amount: null } } as never);
    prismaMock.order.aggregate.mockResolvedValueOnce({
      _sum: { commissionAmount: null },
    } as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.gmvCents).toBe(0);
    expect(body.platformRevenueCents).toBe(0);
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
