import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/inventory/adjust', () => ({
  applyStockChange: vi.fn(),
}));

import { applyOrderRefundedEffects, type OrderForRefundEffects } from './refund';
import { applyStockChange } from '@/lib/server/inventory/adjust';

const mockApplyStockChange = vi.mocked(applyStockChange);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.outboxEvent.create.mockResolvedValue({ id: 'ob1' } as never);
  mockApplyStockChange.mockResolvedValue({
    before: 0,
    after: 0,
    delta: 0,
    effectiveThreshold: 3,
    crossedLowThreshold: false,
    crossedZero: false,
  });
});

const BASE_ORDER: OrderForRefundEffects = {
  id: 'order-1',
  storeId: 'store-1',
  amount: 3600,
  currency: 'USD',
  lineItems: [{ productId: 'prod-a', name: 'Shea Butter', priceCents: 1800, quantity: 2 }],
  customerEmail: 'buyer@example.com',
};

describe('applyOrderRefundedEffects', () => {
  it('sets the order status to REFUNDED', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'REFUNDED' },
    });
  });

  it('writes a REFUNDED audit trail row attributed to the seller', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(prismaMock.orderStatusEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'REFUNDED', actorType: 'SELLER' },
    });
  });

  it('records a REFUND_RESTOCK movement for a lineItem with no variantId', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(mockApplyStockChange).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        storeId: 'store-1',
        productId: 'prod-a',
        variantId: null,
        delta: 2,
        reason: 'REFUND_RESTOCK',
        actorType: 'SELLER',
        orderId: 'order-1',
      }),
    );
  });

  it('targets the variant (not the product) for a lineItem with a variantId', async () => {
    prismaMock.productVariant.findUnique.mockResolvedValueOnce({ id: 'var-1' } as never);
    await applyOrderRefundedEffects(prismaMock, {
      ...BASE_ORDER,
      lineItems: [
        {
          productId: 'prod-a',
          name: 'Shea Butter',
          priceCents: 2000,
          quantity: 2,
          variantId: 'var-1',
        },
      ],
    });
    expect(mockApplyStockChange).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ productId: 'prod-a', variantId: 'var-1', delta: 2 }),
    );
    expect(prismaMock.product.findUnique).not.toHaveBeenCalled();
  });

  it('enqueues email.order_refunded when the buyer left an email', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(prismaMock.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'email.order_refunded' }),
      }),
    );
  });

  it('skips the email outbox event when there is no customerEmail', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
    await applyOrderRefundedEffects(prismaMock, { ...BASE_ORDER, customerEmail: null });
    expect(prismaMock.outboxEvent.create).not.toHaveBeenCalled();
  });
});
