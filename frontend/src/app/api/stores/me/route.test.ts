import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/stores/me', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  // countLowStock() raw query — default to "nothing low".
  prismaMock.$queryRaw.mockResolvedValue([{ low: 0, out: 0 }] as never);
  // Phase 8 — pending-order count.
  prismaMock.order.count.mockResolvedValue(0 as never);
});

describe('GET /api/stores/me', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('404s with NO_STORE when the seller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('returns the store, real product count, and zeroed visits (no analytics pipeline)', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.findUniqueOrThrow.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      timezone: 'America/New_York',
      ordersPaused: false,
      pauseMessage: null,
      hours: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { products: 3 },
    } as never);
    prismaMock.order.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: 0 } as never);
    prismaMock.$queryRaw.mockResolvedValueOnce([{ low: 2, out: 1 }] as never);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store.id).toBe('store-1');
    expect(body.store._count).toBeUndefined();
    expect(body.stats).toEqual({
      productCount: 3,
      todaySalesCents: 0,
      todayOrdersCount: 0,
      monthSalesCents: 0,
      monthOrdersCount: 0,
      allTimeSalesCents: 0,
      allTimeOrdersCount: 0,
      pendingOrdersCount: 0,
      visits: 0,
      lowStockCount: 2,
      outOfStockCount: 1,
    });
    // Phase 8 — store open/pause state, defaults for a store with no config.
    expect(body.openState).toEqual({
      acceptingOrders: true,
      ordersPaused: false,
      pauseMessage: null,
      hoursConfigured: false,
      openNow: true,
      nextOpenLabel: null,
    });
  });

  it('reports the store as paused + surfaces the pending-order count', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.findUniqueOrThrow.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'shea-store',
      name: 'Shea Store',
      timezone: 'America/New_York',
      ordersPaused: true,
      pauseMessage: 'Back Monday',
      hours: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { products: 1 },
    } as never);
    prismaMock.order.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: 0 } as never);
    prismaMock.order.count.mockResolvedValue(4 as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.openState).toMatchObject({
      acceptingOrders: false,
      ordersPaused: true,
      pauseMessage: 'Back Monday',
    });
    expect(body.stats.pendingOrdersCount).toBe(4);
    const countArgs = prismaMock.order.count.mock.calls[0]?.[0];
    expect(countArgs?.where).toEqual({
      storeId: 'store-1',
      status: { in: ['PAID', 'PREPARING', 'READY'] },
    });
  });

  it('aggregates real PAID-order sums for today vs. this month, scoped to the caller store', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.findUniqueOrThrow.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { products: 1 },
    } as never);
    prismaMock.order.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1800 }, _count: 1 } as never) // today
      .mockResolvedValueOnce({ _sum: { amount: 5400 }, _count: 3 } as never) // month
      .mockResolvedValueOnce({ _sum: { amount: 9000 }, _count: 7 } as never); // all-time

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.stats).toMatchObject({
      todaySalesCents: 1800,
      todayOrdersCount: 1,
      monthSalesCents: 5400,
      monthOrdersCount: 3,
      allTimeSalesCents: 9000,
      allTimeOrdersCount: 7,
    });

    const [todayArgs, monthArgs, allTimeArgs] = prismaMock.order.aggregate.mock.calls;
    // All-time has no date window.
    expect(allTimeArgs?.[0]?.where).toEqual({
      storeId: 'store-1',
      status: { in: ['PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
    });
    expect(todayArgs?.[0]?.where).toMatchObject({
      storeId: 'store-1',
      status: { in: ['PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
    });
    expect(monthArgs?.[0]?.where).toMatchObject({
      storeId: 'store-1',
      status: { in: ['PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
    });
  });

  it('still counts an order in sales after it progresses past PAID to DELIVERED', async () => {
    // Regression: an exact `status: 'PAID'` match made revenue drop to $0 the
    // moment a seller advanced an order past its first post-payment status.
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.findUniqueOrThrow.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { products: 1 },
    } as never);
    prismaMock.order.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: 1 } as never) // today
      .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: 1 } as never) // month
      .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: 1 } as never); // all-time

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.stats).toMatchObject({
      todaySalesCents: 10000,
      todayOrdersCount: 1,
      monthSalesCents: 10000,
      monthOrdersCount: 1,
    });

    const [todayArgs] = prismaMock.order.aggregate.mock.calls;
    const statusFilter = (todayArgs?.[0]?.where as { status?: { in?: string[] } })?.status;
    expect(statusFilter?.in).toContain('DELIVERED');
    expect(statusFilter?.in).not.toContain('CANCELLED');
    expect(statusFilter?.in).not.toContain('PENDING');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
