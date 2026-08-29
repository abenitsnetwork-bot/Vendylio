import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyStockChange, stockStatus } from './adjust';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.stockMovement.create.mockResolvedValue({ id: 'm1' } as never);
});

describe('applyStockChange — product (no variant)', () => {
  it('applies a signed delta, writes the quantity and a ledger row', async () => {
    prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
      quantity: 10,
      lowStockThreshold: null,
    } as never);

    const r = await applyStockChange(prismaMock, {
      storeId: 'store-1',
      productId: 'prod-a',
      delta: -3,
      reason: 'SALE',
      actorType: 'SYSTEM',
      orderId: 'order-1',
      storeDefaultLowStockThreshold: 3,
    });

    expect(r).toMatchObject({ before: 10, after: 7, delta: -3 });
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-a' },
      data: { quantity: 7 },
    });
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 'store-1',
        productId: 'prod-a',
        variantId: null,
        delta: -3,
        resultingQuantity: 7,
        reason: 'SALE',
        actorType: 'SYSTEM',
        orderId: 'order-1',
      }),
    });
  });

  it('sets an absolute newQuantity and records the resulting delta', async () => {
    prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
      quantity: 4,
      lowStockThreshold: null,
    } as never);

    const r = await applyStockChange(prismaMock, {
      storeId: 'store-1',
      productId: 'prod-a',
      newQuantity: 20,
      reason: 'RESTOCK',
      actorType: 'SELLER',
      storeDefaultLowStockThreshold: 3,
    });

    expect(r).toMatchObject({ before: 4, after: 20, delta: 16 });
  });

  it('floors at 0 when floorAtZero is set (concurrent-sale race)', async () => {
    prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
      quantity: 1,
      lowStockThreshold: null,
    } as never);

    const r = await applyStockChange(prismaMock, {
      storeId: 'store-1',
      productId: 'prod-a',
      delta: -5,
      reason: 'SALE',
      actorType: 'SYSTEM',
      floorAtZero: true,
      storeDefaultLowStockThreshold: 3,
    });

    expect(r.after).toBe(0);
    expect(r.delta).toBe(-1);
  });

  it('flags crossing the low-stock threshold (uses the product override when set)', async () => {
    prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
      quantity: 12,
      lowStockThreshold: 10,
    } as never);

    const r = await applyStockChange(prismaMock, {
      storeId: 'store-1',
      productId: 'prod-a',
      delta: -3,
      reason: 'SALE',
      actorType: 'SYSTEM',
      storeDefaultLowStockThreshold: 3,
    });

    expect(r.effectiveThreshold).toBe(10);
    expect(r.crossedLowThreshold).toBe(true);
    expect(r.crossedZero).toBe(false);
  });

  it('flags crossing zero', async () => {
    prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
      quantity: 2,
      lowStockThreshold: null,
    } as never);

    const r = await applyStockChange(prismaMock, {
      storeId: 'store-1',
      productId: 'prod-a',
      delta: -2,
      reason: 'SALE',
      actorType: 'SYSTEM',
      floorAtZero: true,
      storeDefaultLowStockThreshold: 3,
    });

    expect(r.crossedZero).toBe(true);
  });

  it('reads the store default threshold when the caller does not pass it', async () => {
    prismaMock.store.findUniqueOrThrow.mockResolvedValueOnce({
      defaultLowStockThreshold: 7,
    } as never);
    prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
      quantity: 8,
      lowStockThreshold: null,
    } as never);

    const r = await applyStockChange(prismaMock, {
      storeId: 'store-1',
      productId: 'prod-a',
      delta: -1,
      reason: 'MANUAL_ADJUST',
      actorType: 'SELLER',
    });

    expect(r.effectiveThreshold).toBe(7);
    expect(r.crossedLowThreshold).toBe(true);
  });

  it('throws when neither delta nor newQuantity is supplied', async () => {
    await expect(
      applyStockChange(prismaMock, {
        storeId: 'store-1',
        productId: 'prod-a',
        reason: 'MANUAL_ADJUST',
        actorType: 'SELLER',
        storeDefaultLowStockThreshold: 3,
      }),
    ).rejects.toThrow(/delta.*newQuantity/);
  });
});

describe('applyStockChange — variant', () => {
  it('writes the variant quantity, not the product, and tags the movement with variantId', async () => {
    prismaMock.productVariant.findUniqueOrThrow.mockResolvedValueOnce({ quantity: 5 } as never);
    prismaMock.product.findUniqueOrThrow.mockResolvedValueOnce({
      lowStockThreshold: null,
    } as never);

    await applyStockChange(prismaMock, {
      storeId: 'store-1',
      productId: 'prod-a',
      variantId: 'var-1',
      delta: 3,
      reason: 'REFUND_RESTOCK',
      actorType: 'SELLER',
      storeDefaultLowStockThreshold: 3,
    });

    expect(prismaMock.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { quantity: 8 },
    });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(prismaMock.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ variantId: 'var-1', delta: 3, resultingQuantity: 8 }),
    });
  });
});

describe('stockStatus', () => {
  it('OUT at or below zero, LOW at or below threshold, OK otherwise', () => {
    expect(stockStatus(0, 3)).toBe('OUT');
    expect(stockStatus(-1, 3)).toBe('OUT');
    expect(stockStatus(3, 3)).toBe('LOW');
    expect(stockStatus(1, 3)).toBe('LOW');
    expect(stockStatus(4, 3)).toBe('OK');
  });
});
