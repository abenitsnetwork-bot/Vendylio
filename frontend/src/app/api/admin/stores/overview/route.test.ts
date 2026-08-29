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
  return new NextRequest('http://test/api/admin/stores/overview', { method: 'GET' });
}

function storeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    slug: 'demo-store',
    name: 'Demo Store',
    logoUrl: null,
    phone: '+1 555 0100',
    city: 'Baltimore',
    state: 'MD',
    pickupAddress: null,
    published: true,
    ordersPaused: false,
    timezone: 'America/New_York',
    hours: [],
    template: 'MODERN',
    _count: { products: 4 },
    reviews: [{ rating: 5 }, { rating: 4 }],
    orders: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.store.findMany.mockResolvedValue([]);
  prismaMock.order.count.mockResolvedValue(0 as never);
  prismaMock.review.aggregate.mockResolvedValue({ _avg: { rating: null } } as never);
  prismaMock.order.aggregate.mockResolvedValue({ _sum: { amount: null } } as never);
});

describe('GET /api/admin/stores/overview', () => {
  it('propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    expect((await GET(makeGet())).status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    expect((await GET(makeGet())).status).toBe(429);
  });

  it('returns a zeroed summary and empty list on no stores', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toMatchObject({
      totalStores: 0,
      activeStores: 0,
      inactiveStores: 0,
      openStores: 0,
      closedStores: 0,
      totalSalesCents: 0,
      totalOrders: 0,
      salesGrowthPct: null,
      avgRating: null,
      topStore: null,
    });
    expect(body.stores).toEqual([]);
  });

  it('enriches a store with rating, open state, address and GMV', async () => {
    prismaMock.store.findMany.mockResolvedValueOnce([
      storeRow({
        orders: [{ amount: 10_000 }, { amount: 5_000 }, { amount: 10_000 }],
      }),
    ] as never);
    prismaMock.order.count.mockResolvedValueOnce(9 as never);

    const res = await GET(makeGet());
    const body = await res.json();

    expect(body.summary.totalStores).toBe(1);
    expect(body.summary.activeStores).toBe(1);
    expect(body.summary.openStores).toBe(1); // published, not paused, no hours
    expect(body.summary.totalSalesCents).toBe(25_000);
    expect(body.summary.totalOrders).toBe(9);
    expect(body.summary.topStore).toEqual({ name: 'Demo Store', slug: 'demo-store' });

    const store = body.stores[0];
    expect(store).toMatchObject({
      id: 's1',
      openLabel: 'Open',
      isOpen: true,
      avgRating: 4.5,
      reviewCount: 2,
      address: 'Baltimore, MD',
      productCount: 4,
      paidOrders: 3,
      gmvCents: 25_000,
      performance: 'Average',
    });
  });

  it('labels a paused store as Paused and counts it as closed', async () => {
    prismaMock.store.findMany.mockResolvedValueOnce([
      storeRow({ ordersPaused: true, reviews: [] }),
    ] as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.summary.openStores).toBe(0);
    expect(body.summary.closedStores).toBe(1);
    expect(body.stores[0].openLabel).toBe('Paused');
    expect(body.stores[0].performance).toBe('Needs attention'); // published, 0 paid orders
  });

  it('labels an unpublished store as Inactive', async () => {
    prismaMock.store.findMany.mockResolvedValueOnce([
      storeRow({ published: false, reviews: [] }),
    ] as never);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.summary.activeStores).toBe(0);
    expect(body.summary.inactiveStores).toBe(1);
    expect(body.stores[0].openLabel).toBe('Inactive');
  });

  it('computes month-over-month sales growth', async () => {
    prismaMock.order.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 12_000 } } as never) // this month
      .mockResolvedValueOnce({ _sum: { amount: 10_000 } } as never); // prev month
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.summary.salesGrowthPct).toBe(20);
  });
});
