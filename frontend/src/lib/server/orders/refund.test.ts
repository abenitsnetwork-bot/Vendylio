import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyOrderRefundedEffects, type OrderForRefundEffects } from './refund';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.outboxEvent.create.mockResolvedValue({ id: 'ob1' } as never);
});

const BASE_ORDER: OrderForRefundEffects = {
  id: 'order-1',
  amount: 3600,
  currency: 'USD',
  lineItems: [{ productId: 'prod-a', name: 'Shea Butter', priceCents: 1800, quantity: 2 }],
  customerEmail: 'buyer@example.com',
};

describe('applyOrderRefundedEffects', () => {
  it('sets the order status to REFUNDED', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 8 } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'REFUNDED' },
    });
  });

  it('writes a REFUNDED audit trail row attributed to the seller', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 8 } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(prismaMock.orderStatusEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'REFUNDED', actorType: 'SELLER' },
    });
  });

  it('restocks Product.quantity for a lineItem with no variantId', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 8 } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-a' },
      data: { quantity: 10 },
    });
  });

  it('restocks ProductVariant.quantity (not Product) for a lineItem with a variantId', async () => {
    prismaMock.productVariant.findUnique.mockResolvedValueOnce({ quantity: 3 } as never);
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
    expect(prismaMock.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { quantity: 5 },
    });
    expect(prismaMock.product.findUnique).not.toHaveBeenCalled();
  });

  it('enqueues email.order_refunded when the buyer left an email', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 8 } as never);
    await applyOrderRefundedEffects(prismaMock, BASE_ORDER);
    expect(prismaMock.outboxEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: 'email.order_refunded' }),
      }),
    );
  });

  it('skips the email outbox event when there is no customerEmail', async () => {
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 8 } as never);
    await applyOrderRefundedEffects(prismaMock, { ...BASE_ORDER, customerEmail: null });
    expect(prismaMock.outboxEvent.create).not.toHaveBeenCalled();
  });
});
