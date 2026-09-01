// GET /api/admin/pulse — dashboard KPI deltas + 30-day daily series + queue health.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({ enforceAdminRateLimit: vi.fn() }));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const adminCtx = {
  user: { sub: 'admin_1', email: 'admin@test.local' },
  admin: { id: 'admin_1', email: 'admin@test.local', role: 'ADMIN' as const },
};

const makeGet = () => new NextRequest('http://test/api/admin/pulse', { method: 'GET' });
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
  // Empty platform by default — every count 0, every list empty.
  prismaMock.organization.count.mockResolvedValue(0);
  prismaMock.store.count.mockResolvedValue(0);
  prismaMock.delivery.count.mockResolvedValue(0);
  prismaMock.order.count.mockResolvedValue(0);
  prismaMock.outboxEvent.count.mockResolvedValue(0);
  prismaMock.emailJob.count.mockResolvedValue(0);
  prismaMock.withdrawal.count.mockResolvedValue(0);
  prismaMock.order.findMany.mockResolvedValue([] as never);
  prismaMock.customer.findMany.mockResolvedValue([] as never);
});

describe('GET /api/admin/pulse', () => {
  it('propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
    expect(prismaMock.organization.count).not.toHaveBeenCalled();
  });

  it('propagates 429 from the admin rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(429);
    expect(prismaMock.organization.count).not.toHaveBeenCalled();
  });

  it('returns a full shape on an empty platform (zeros, null deltas, 30-point series)', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.periodDays).toBe(30);
    expect(Object.keys(body.kpis).sort()).toEqual(
      [
        'activeDeliveries',
        'activeStores',
        'failedPayments',
        'gmv',
        'merchants',
        'newCustomers',
        'orders',
        'platformRevenue',
      ].sort(),
    );
    expect(body.kpis.gmv).toEqual({ value: 0, deltaPct: null, spark: Array(30).fill(0) });
    expect(body.kpis.merchants).toEqual({ value: 0, addedInPeriod: 0 });
    expect(body.kpis.activeDeliveries).toEqual({ value: 0 });
    expect(body.daily).toHaveLength(30);
    expect(body.daily[0]).toMatchObject({ gmvCents: 0, orderCount: 0, newCustomers: 0 });
    expect(body.queue).toEqual({
      outboxPending: 0,
      outboxFailed: 0,
      emailPending: 0,
      emailFailed: 0,
      deliveriesInFlight: 0,
      withdrawalsPending: 0,
    });
  });

  it('computes GMV / orders deltas from this-30d vs the prior 30d', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      // this period: 2 orders, $150
      { amount: 10000, commissionAmount: 600, paidAt: daysAgo(3) },
      { amount: 5000, commissionAmount: 300, paidAt: daysAgo(10) },
      // prior period: 1 order, $100
      { amount: 10000, commissionAmount: 600, paidAt: daysAgo(40) },
    ] as never);

    const res = await GET(makeGet());
    const body = await res.json();

    expect(body.kpis.gmv.value).toBe(15000);
    expect(body.kpis.gmv.deltaPct).toBe(50); // (15000-10000)/10000
    expect(body.kpis.orders.value).toBe(2);
    expect(body.kpis.orders.deltaPct).toBe(100); // (2-1)/1
    expect(body.kpis.platformRevenue.value).toBe(900);
    // spark sums to the period total
    expect(body.kpis.gmv.spark.reduce((a: number, b: number) => a + b, 0)).toBe(15000);
  });

  it('surfaces queue health counts and scopes in-flight deliveries to REQUESTED', async () => {
    prismaMock.outboxEvent.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
    prismaMock.delivery.count.mockResolvedValue(7);
    prismaMock.withdrawal.count.mockResolvedValue(2);

    const res = await GET(makeGet());
    const body = await res.json();

    expect(body.queue.outboxPending).toBe(4);
    expect(body.queue.outboxFailed).toBe(1);
    expect(body.queue.deliveriesInFlight).toBe(7);
    expect(body.queue.withdrawalsPending).toBe(2);
    expect(prismaMock.delivery.count).toHaveBeenCalledWith({ where: { status: 'REQUESTED' } });
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
