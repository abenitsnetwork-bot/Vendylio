// Phase 10 (extended) — GET /api/admin/analytics chart-ready aggregates.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Frozen "now" — 2026-06-15. The 6-month window is Jan..Jun 2026.
const NOW = new Date('2026-06-15T12:00:00.000Z');

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/admin/analytics', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.order.findMany.mockResolvedValue([]);
  prismaMock.customer.findMany.mockResolvedValue([]);
  prismaMock.product.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/admin/analytics', () => {
  it('propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(429);
  });

  it('returns 6 zeroed month buckets (Jan..Jun) when there is no data', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revenueByMonth).toEqual([
      { month: 'Jan', gmvCents: 0, orderCount: 0 },
      { month: 'Feb', gmvCents: 0, orderCount: 0 },
      { month: 'Mar', gmvCents: 0, orderCount: 0 },
      { month: 'Apr', gmvCents: 0, orderCount: 0 },
      { month: 'May', gmvCents: 0, orderCount: 0 },
      { month: 'Jun', gmvCents: 0, orderCount: 0 },
    ]);
    expect(body.customerGrowthByMonth).toHaveLength(6);
    expect(
      body.customerGrowthByMonth.every((m: { newCustomers: number }) => m.newCustomers === 0),
    ).toBe(true);
    expect(body.salesByCategory).toEqual([]);
    expect(body.topProducts).toEqual([]);
  });

  it('queries orders/customers scoped to the 6-month window start (Jan 1)', async () => {
    await GET(makeGet());
    const orderArgs = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(orderArgs?.where).toMatchObject({
      status: 'PAID',
      paidAt: { gte: new Date('2026-01-01T00:00:00.000Z') },
    });
    const customerArgs = prismaMock.customer.findMany.mock.calls[0]?.[0];
    expect(customerArgs?.where).toEqual({
      createdAt: { gte: new Date('2026-01-01T00:00:00.000Z') },
    });
  });

  it('buckets a PAID order into the correct month by paidAt', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      {
        amount: 5000,
        paidAt: new Date('2026-03-10T00:00:00.000Z'),
        lineItems: [],
      },
    ] as never);

    const res = await GET(makeGet());
    const body = await res.json();
    const march = body.revenueByMonth.find((m: { month: string }) => m.month === 'Mar');
    expect(march).toEqual({ month: 'Mar', gmvCents: 5000, orderCount: 1 });
  });

  it('aggregates revenue by product category via a live Product lookup', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      {
        amount: 3600,
        paidAt: new Date('2026-06-01T00:00:00.000Z'),
        lineItems: [{ productId: 'p1', name: 'Shea Butter', priceCents: 1800, quantity: 2 }],
      },
    ] as never);
    prismaMock.product.findMany.mockResolvedValueOnce([
      { id: 'p1', category: 'BEAUTY_PERSONAL_CARE' },
    ] as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.salesByCategory).toEqual([
      { category: 'BEAUTY_PERSONAL_CARE', revenueCents: 3600 },
    ]);
  });

  it('falls back to Uncategorized when the product no longer exists', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      {
        amount: 1000,
        paidAt: new Date('2026-06-01T00:00:00.000Z'),
        lineItems: [{ productId: 'deleted-product', name: 'Gone', priceCents: 1000, quantity: 1 }],
      },
    ] as never);
    prismaMock.product.findMany.mockResolvedValueOnce([]); // product no longer exists

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.salesByCategory).toEqual([{ category: 'Uncategorized', revenueCents: 1000 }]);
  });

  it('ranks topProducts by revenue descending and caps at 5', async () => {
    const lineItems = Array.from({ length: 7 }, (_, i) => ({
      productId: `p${i}`,
      name: `Product ${i}`,
      priceCents: (i + 1) * 100,
      quantity: 1,
    }));
    prismaMock.order.findMany.mockResolvedValueOnce([
      { amount: 2800, paidAt: new Date('2026-06-01T00:00:00.000Z'), lineItems },
    ] as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.topProducts).toHaveLength(5);
    expect(body.topProducts[0]).toMatchObject({ productId: 'p6', revenueCents: 700 });
    expect(body.topProducts[4]).toMatchObject({ productId: 'p2', revenueCents: 300 });
  });

  it('counts customer growth by createdAt month', async () => {
    prismaMock.customer.findMany.mockResolvedValueOnce([
      { createdAt: new Date('2026-05-02T00:00:00.000Z') },
      { createdAt: new Date('2026-05-20T00:00:00.000Z') },
      { createdAt: new Date('2026-06-01T00:00:00.000Z') },
    ] as never);

    const res = await GET(makeGet());
    const body = await res.json();
    const may = body.customerGrowthByMonth.find((m: { month: string }) => m.month === 'May');
    const jun = body.customerGrowthByMonth.find((m: { month: string }) => m.month === 'Jun');
    expect(may.newCustomers).toBe(2);
    expect(jun.newCustomers).toBe(1);
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
