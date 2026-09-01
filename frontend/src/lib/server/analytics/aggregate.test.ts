import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  storeDayKey,
  dayKeyToDate,
  recordStorefrontView,
  readAnalytics,
  recentVisitCount,
} from './aggregate';

beforeEach(() => {
  // mockDeep resets automatically via the test-util beforeEach.
});

describe('storeDayKey / dayKeyToDate', () => {
  it('buckets the calendar date in the store timezone', () => {
    // 2026-09-01T02:00Z is still Aug 31 in New York.
    const at = new Date('2026-09-01T02:00:00.000Z');
    expect(storeDayKey('America/New_York', at)).toBe('2026-08-31');
    expect(storeDayKey('UTC', at)).toBe('2026-09-01');
  });

  it('round-trips a key to a UTC-midnight Date on the same calendar date', () => {
    const d = dayKeyToDate('2026-08-31');
    expect(d.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('falls back to UTC for an unknown zone', () => {
    const at = new Date('2026-09-01T12:00:00.000Z');
    expect(storeDayKey('Not/AZone', at)).toBe('2026-09-01');
  });
});

describe('recordStorefrontView', () => {
  it('increments store views + a new visitor for a STORE hit', async () => {
    await recordStorefrontView(prismaMock, {
      storeId: 's1',
      tz: 'UTC',
      kind: 'STORE',
      newVisitor: true,
      now: new Date('2026-09-01T10:00:00Z'),
    });
    const call = prismaMock.storefrontDayStat.upsert.mock.calls[0]?.[0];
    expect(call?.create).toMatchObject({
      storeId: 's1',
      storeViews: 1,
      productViews: 0,
      visitors: 1,
    });
    expect(call?.update).toMatchObject({
      storeViews: { increment: 1 },
      productViews: { increment: 0 },
      visitors: { increment: 1 },
    });
    expect(prismaMock.productViewDayStat.upsert).not.toHaveBeenCalled();
  });

  it('records a product view only when the product belongs to the store', async () => {
    prismaMock.product.findFirst.mockResolvedValueOnce({ id: 'p1' } as never);
    await recordStorefrontView(prismaMock, {
      storeId: 's1',
      tz: 'UTC',
      kind: 'PRODUCT',
      productId: 'p1',
      newVisitor: false,
      now: new Date('2026-09-01T10:00:00Z'),
    });
    expect(prismaMock.productViewDayStat.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.storefrontDayStat.upsert.mock.calls[0]?.[0];
    expect(call?.update).toMatchObject({
      productViews: { increment: 1 },
      visitors: { increment: 0 },
    });
  });

  it('skips the product counter for a foreign productId', async () => {
    prismaMock.product.findFirst.mockResolvedValueOnce(null);
    await recordStorefrontView(prismaMock, {
      storeId: 's1',
      tz: 'UTC',
      kind: 'PRODUCT',
      productId: 'other',
      newVisitor: false,
    });
    expect(prismaMock.productViewDayStat.upsert).not.toHaveBeenCalled();
  });
});

describe('readAnalytics', () => {
  it('builds a zero-filled series, totals and conversion rate', async () => {
    const now = new Date('2026-09-03T12:00:00Z');
    prismaMock.storefrontDayStat.findMany.mockResolvedValueOnce([
      {
        storeId: 's1',
        day: new Date('2026-09-02T00:00:00Z'),
        storeViews: 10,
        productViews: 4,
        visitors: 8,
      },
    ] as never);
    prismaMock.order.findMany.mockResolvedValueOnce([
      { paidAt: new Date('2026-09-02T15:00:00Z'), amount: 2500 },
      { paidAt: new Date('2026-09-02T18:00:00Z'), amount: 1500 },
    ] as never);
    (
      prismaMock.productViewDayStat.groupBy as unknown as {
        mockResolvedValueOnce: (v: unknown) => void;
      }
    ).mockResolvedValueOnce([{ productId: 'p1', _sum: { views: 4 } }]);
    prismaMock.product.findMany.mockResolvedValueOnce([{ id: 'p1', name: 'Widget' }] as never);

    const res = await readAnalytics(prismaMock, { storeId: 's1', tz: 'UTC', range: 7, now });

    expect(res.series).toHaveLength(7);
    expect(res.series[res.series.length - 2]).toMatchObject({
      day: '2026-09-02',
      storeViews: 10,
      orders: 2,
      salesCents: 4000,
    });
    expect(res.totals).toMatchObject({ views: 14, visitors: 8, orders: 2, salesCents: 4000 });
    expect(res.totals.conversionRate).toBeCloseTo(2 / 8);
    expect(res.topProducts[0]).toEqual({ productId: 'p1', name: 'Widget', views: 4 });
  });

  it('conversion rate is 0 with no visitors', async () => {
    prismaMock.storefrontDayStat.findMany.mockResolvedValueOnce([]);
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    (
      prismaMock.productViewDayStat.groupBy as unknown as {
        mockResolvedValueOnce: (v: unknown) => void;
      }
    ).mockResolvedValueOnce([]);
    const res = await readAnalytics(prismaMock, { storeId: 's1', tz: 'UTC', range: 30 });
    expect(res.totals.conversionRate).toBe(0);
    expect(res.series).toHaveLength(30);
  });
});

describe('recentVisitCount', () => {
  it('sums storeViews and tolerates an undefined aggregate', async () => {
    prismaMock.storefrontDayStat.aggregate.mockResolvedValueOnce({
      _sum: { storeViews: 42 },
    } as never);
    expect(await recentVisitCount(prismaMock, { storeId: 's1', tz: 'UTC' })).toBe(42);

    (
      prismaMock.storefrontDayStat.aggregate as unknown as {
        mockResolvedValueOnce: (v: unknown) => void;
      }
    ).mockResolvedValueOnce(undefined);
    expect(await recentVisitCount(prismaMock, { storeId: 's1', tz: 'UTC' })).toBe(0);
  });
});
