import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { resolveOwnStore } from '@/lib/server/org';
import { getDashboardOverview } from './overview';

const mockResolveOwnStore = vi.mocked(resolveOwnStore);

const BASE_STORE = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
  prismaMock.store.findUniqueOrThrow.mockResolvedValue(BASE_STORE as never);
  prismaMock.user.findUnique.mockResolvedValue({
    name: 'Amara Okafor',
    email: 'amara@example.com',
  } as never);
  prismaMock.order.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: 0 } as never);
  prismaMock.$queryRaw.mockResolvedValue([{ low: 0, out: 0 }] as never);
  prismaMock.order.count.mockResolvedValue(0 as never);
  prismaMock.order.findMany.mockResolvedValue([] as never);
});

describe('getDashboardOverview', () => {
  it('returns null when the caller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    await expect(getDashboardOverview('user-1')).resolves.toBeNull();
  });

  it('resolves the seller name for the greeting', async () => {
    const result = await getDashboardOverview('user-1');
    expect(result?.userName).toBe('Amara Okafor');
  });

  it('falls back to null when the user has no name set', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ name: null, email: 'a@b.com' } as never);
    const result = await getDashboardOverview('user-1');
    expect(result?.userName).toBeNull();
  });

  it('aggregates today/month/all-time sales in that call order', async () => {
    prismaMock.order.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 1800 }, _count: 1 } as never) // today
      .mockResolvedValueOnce({ _sum: { amount: 5400 }, _count: 3 } as never) // month
      .mockResolvedValueOnce({ _sum: { amount: 9000 }, _count: 7 } as never); // all-time

    const result = await getDashboardOverview('user-1');
    expect(result?.stats).toMatchObject({
      todaySalesCents: 1800,
      todayOrdersCount: 1,
      monthSalesCents: 5400,
      monthOrdersCount: 3,
      allTimeSalesCents: 9000,
      allTimeOrdersCount: 7,
    });
    const [, , allTimeArgs] = prismaMock.order.aggregate.mock.calls;
    expect(allTimeArgs?.[0]?.where).toEqual({
      storeId: 'store-1',
      status: { in: ['PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
    });
  });

  it('surfaces low-stock/out-of-stock counts and the pending-order count', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ low: 2, out: 1 }] as never);
    prismaMock.order.count.mockResolvedValueOnce(4 as never); // pending
    const result = await getDashboardOverview('user-1');
    expect(result?.stats.lowStockCount).toBe(2);
    expect(result?.stats.outOfStockCount).toBe(1);
    expect(result?.stats.pendingOrdersCount).toBe(4);
    const countArgs = prismaMock.order.count.mock.calls[0]?.[0];
    expect(countArgs?.where).toEqual({
      storeId: 'store-1',
      status: { in: ['PAID', 'PREPARING', 'READY'] },
    });
  });

  it('computes a 0-100 fulfillment rate from delivered vs. paid orders this month', async () => {
    prismaMock.order.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: 0 } as never) // today
      .mockResolvedValueOnce({ _sum: { amount: 10000 }, _count: 4 } as never) // month
      .mockResolvedValueOnce({ _sum: { amount: 0 }, _count: 0 } as never); // all-time
    // pending count (1st order.count call) then delivered-this-month (2nd)
    prismaMock.order.count.mockResolvedValueOnce(0 as never).mockResolvedValueOnce(3 as never);

    const result = await getDashboardOverview('user-1');
    expect(result?.fulfillmentRatePct).toBe(75); // 3 of 4
  });

  it('fulfillment rate is 0, never NaN, when there were no paid orders this month', async () => {
    const result = await getDashboardOverview('user-1');
    expect(result?.fulfillmentRatePct).toBe(0);
  });

  it("buckets this week's paid orders into 7 daily totals, oldest first, excluding older orders", async () => {
    const now = new Date();
    const today = new Date(now);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // outside the window

    prismaMock.order.findMany.mockImplementation((args: unknown) => {
      const a = args as { where?: { paidAt?: unknown }; select?: { paidAt?: boolean } };
      // The weekly-sales query selects paidAt+amount only; the recent-orders
      // query selects orderNumber — use that to tell the two apart.
      if (a?.select?.paidAt) {
        return Promise.resolve([
          { paidAt: today, amount: 500 },
          { paidAt: twoDaysAgo, amount: 300 },
          { paidAt: tenDaysAgo, amount: 9999 },
        ]) as never;
      }
      return Promise.resolve([]) as never;
    });

    const result = await getDashboardOverview('user-1');
    expect(result?.weeklySales).toHaveLength(7);
    const total = result?.weeklySales.reduce((sum, d) => sum + d.salesCents, 0);
    expect(total).toBe(800); // 500 + 300, the 10-day-old order is excluded
    expect(result?.weeklySales.at(-1)?.salesCents).toBe(500); // today is the last bucket
  });

  it('maps recent orders to the public shape with an ISO date string', async () => {
    prismaMock.order.findMany.mockImplementation((args: unknown) => {
      const a = args as { select?: { orderNumber?: boolean } };
      if (a?.select?.orderNumber) {
        return Promise.resolve([
          {
            id: 'ord-1',
            orderNumber: 10042,
            status: 'PAID',
            amount: 1800,
            currency: 'USD',
            customerName: 'Jo',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]) as never;
      }
      return Promise.resolve([]) as never;
    });

    const result = await getDashboardOverview('user-1');
    expect(result?.recentOrders).toEqual([
      {
        id: 'ord-1',
        orderNumber: 10042,
        status: 'PAID',
        amount: 1800,
        currency: 'USD',
        customerName: 'Jo',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('never leaks the internal Prisma _count field on the returned store', async () => {
    const result = await getDashboardOverview('user-1');
    expect(result?.store).not.toHaveProperty('_count');
    expect(result?.stats.productCount).toBe(3);
  });
});
