import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sweepLowStock, countLowStock } from './low-stock';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.outboxEvent.create.mockResolvedValue({ id: 'oe1' } as never);
});

describe('sweepLowStock', () => {
  it('enqueues notification.low_stock for a row still above zero and out_of_stock for one at zero', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        productId: 'prod-a',
        variantId: null,
        productName: 'Shea Butter',
        variantLabel: null,
        quantity: 2,
        threshold: 3,
        ownerId: 'seller-1',
      },
      {
        productId: 'prod-b',
        variantId: 'var-1',
        productName: 'Kente Cloth',
        variantLabel: 'Size / L',
        quantity: 0,
        threshold: 5,
        ownerId: 'seller-1',
      },
    ] as never);

    const result = await sweepLowStock({ prisma: prismaMock });

    expect(result).toEqual({ scanned: 2, enqueued: 2 });
    const events = prismaMock.outboxEvent.create.mock.calls.map(
      (c) => (c[0] as { data: { kind: string; payload: Record<string, unknown> } }).data,
    );
    expect(events[0]).toMatchObject({
      kind: 'notification.low_stock',
      payload: { productId: 'prod-a', userId: 'seller-1', quantity: 2, threshold: 3 },
    });
    expect(events[1]).toMatchObject({
      kind: 'notification.out_of_stock',
      payload: { productId: 'prod-b', variantId: 'var-1', variantLabel: 'Size / L' },
    });
  });

  it('is a no-op when nothing is below threshold', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([] as never);
    const result = await sweepLowStock({ prisma: prismaMock });
    expect(result).toEqual({ scanned: 0, enqueued: 0 });
    expect(prismaMock.outboxEvent.create).not.toHaveBeenCalled();
  });
});

describe('countLowStock', () => {
  it('returns the low / out counts from the aggregate query', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ low: 4, out: 1 }] as never);
    const r = await countLowStock(prismaMock, 'store-1');
    expect(r).toEqual({ lowStockCount: 4, outOfStockCount: 1 });
  });

  it('defaults to zero when the query returns no row', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([] as never);
    const r = await countLowStock(prismaMock, 'store-1');
    expect(r).toEqual({ lowStockCount: 0, outOfStockCount: 0 });
  });
});
