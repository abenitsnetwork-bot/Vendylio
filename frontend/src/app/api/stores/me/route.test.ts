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
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { products: 3 },
    } as never);
    prismaMock.order.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: 0 } as never);

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
      visits: 0,
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
      .mockResolvedValueOnce({ _sum: { amount: 5400 }, _count: 3 } as never); // month

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.stats).toMatchObject({
      todaySalesCents: 1800,
      todayOrdersCount: 1,
      monthSalesCents: 5400,
      monthOrdersCount: 3,
    });

    const [todayArgs, monthArgs] = prismaMock.order.aggregate.mock.calls;
    expect(todayArgs?.[0]?.where).toMatchObject({ storeId: 'store-1', status: 'PAID' });
    expect(monthArgs?.[0]?.where).toMatchObject({ storeId: 'store-1', status: 'PAID' });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
