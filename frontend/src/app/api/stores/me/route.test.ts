import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/dashboard/overview', () => ({
  getDashboardOverview: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { getDashboardOverview } from '@/lib/server/dashboard/overview';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetDashboardOverview = vi.mocked(getDashboardOverview);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

const FULL_OVERVIEW = {
  userName: 'Amara Okafor',
  store: { id: 'store-1', slug: 'shea-store', name: 'Shea Store' },
  openState: {
    acceptingOrders: true,
    ordersPaused: false,
    pauseMessage: null,
    hoursConfigured: false,
    openNow: true,
    nextOpenLabel: null,
  },
  stats: {
    productCount: 3,
    todaySalesCents: 0,
    todayOrdersCount: 0,
    monthSalesCents: 0,
    monthOrdersCount: 0,
    allTimeSalesCents: 0,
    allTimeOrdersCount: 0,
    pendingOrdersCount: 0,
    visits: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  },
  recentOrders: [
    {
      id: 'ord-1',
      orderNumber: 1,
      status: 'PAID',
      amount: 100,
      currency: 'USD',
      customerName: 'Jo',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  weeklySales: [{ label: 'Mon', salesCents: 0 }],
  fulfillmentRatePct: 0,
} as never;

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
    mockGetDashboardOverview.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('returns only store/openState/stats — the extracted extras (recentOrders, weeklySales, userName, fulfillmentRatePct) stay off this public JSON contract', async () => {
    mockGetDashboardOverview.mockResolvedValue(FULL_OVERVIEW);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['openState', 'stats', 'store']);
    expect(body.store).toEqual({ id: 'store-1', slug: 'shea-store', name: 'Shea Store' });
    expect(body.stats.productCount).toBe(3);
    expect(body.openState.acceptingOrders).toBe(true);
  });

  it("passes the caller's sub through to getDashboardOverview", async () => {
    mockGetDashboardOverview.mockResolvedValue(FULL_OVERVIEW);
    await GET(makeGet());
    expect(mockGetDashboardOverview).toHaveBeenCalledWith('user-1');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
