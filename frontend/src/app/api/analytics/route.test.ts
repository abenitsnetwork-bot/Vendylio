import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

const readAnalytics = vi.fn(async () => ({
  range: 30,
  series: [],
  totals: {
    views: 0,
    storeViews: 0,
    productViews: 0,
    visitors: 0,
    orders: 0,
    salesCents: 0,
    conversionRate: 0,
  },
  topProducts: [],
}));
vi.mock('@/lib/server/analytics/aggregate', () => ({
  readAnalytics: (...a: unknown[]) => readAnalytics(...(a as [])),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockStore = vi.mocked(resolveOwnStore);

function req(range?: string) {
  const url = range ? `http://test/api/analytics?range=${range}` : 'http://test/api/analytics';
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { sub: 'u1', email: 'x@x.com' } });
  mockStore.mockResolvedValue({ id: 's1', plan: 'PRO', timezone: 'UTC' } as never);
});

describe('GET /api/analytics', () => {
  it('401s when auth bails', async () => {
    mockAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await GET(req())).status).toBe(401);
  });

  it('404s NO_STORE', async () => {
    mockStore.mockResolvedValueOnce(null);
    expect((await GET(req())).status).toBe(404);
  });

  it('402s PLAN_UPGRADE_REQUIRED for a Free store', async () => {
    mockStore.mockResolvedValueOnce({ id: 's1', plan: 'FREE', timezone: 'UTC' } as never);
    const res = await GET(req());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe('PLAN_UPGRADE_REQUIRED');
    expect(readAnalytics).not.toHaveBeenCalled();
  });

  it('returns the summary for a Pro store and clamps an invalid range to 30', async () => {
    const res = await GET(req('999'));
    expect(res.status).toBe(200);
    expect(readAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeId: 's1', tz: 'UTC', range: 30 }),
    );
  });

  it('honours an allowed range', async () => {
    await GET(req('7'));
    expect(readAnalytics).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ range: 7 }),
    );
  });
});
