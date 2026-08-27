// Extracted from api/webhooks/stripe/route.test.ts's Phase 2/4/6/7/12
// coverage — same assertions, now exercised directly against the shared
// function instead of only through the Stripe webhook HTTP layer.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyOrderPaidEffects, type OrderForPaidEffects } from './markPaid';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.platformSettings.findUnique.mockResolvedValue(null); // no row yet = 0% commission
  prismaMock.customer.findUnique.mockResolvedValue(null);
  prismaMock.outboxEvent.create.mockResolvedValue({ id: 'ob1' } as never);
});

const BASE_ORDER: OrderForPaidEffects = {
  id: 'order-1',
  storeId: 'store-1',
  amount: 3600,
  currency: 'USD',
  lineItems: [{ productId: 'prod-a', name: 'Shea Butter', priceCents: 1800, quantity: 2 }],
  customerPhone: null,
  customerName: null,
  customerEmail: 'buyer@example.com',
  deliveryAddress: null,
};

describe('applyOrderPaidEffects', () => {
  it('marks the order PAID with commission/net computed from PlatformSettings.commissionRateBp', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 600,
      commissionRateBpPro: null,
      updatedAt: new Date(),
    } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, { paymentMethod: 'card' });

    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'PAID',
        commissionAmount: 216, // floor(3600 * 600 / 10000)
        netAmount: 3384,
        paymentMethod: 'card',
      }),
    });
    expect(prismaMock.orderStatusEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'PAID', actorType: 'SYSTEM' },
    });
  });

  it('decrements Product.quantity for a lineItem with no variantId', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-a' },
      data: { quantity: 8 },
    });
  });

  it('decrements ProductVariant.quantity (not Product) for a lineItem with a variantId', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.productVariant.findUnique.mockResolvedValueOnce({ quantity: 5 } as never);

    await applyOrderPaidEffects(
      prismaMock,
      {
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
      },
      {},
    );

    expect(prismaMock.productVariant.update).toHaveBeenCalledWith({
      where: { id: 'var-1' },
      data: { quantity: 3 },
    });
    expect(prismaMock.product.findUnique).not.toHaveBeenCalled();
  });

  it('floors stock at 0 instead of going negative', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 1 } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});
    expect(prismaMock.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-a' },
      data: { quantity: 0 },
    });
  });

  it('upserts the Customer directory keyed on (storeId, phone)', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);
    prismaMock.customer.findUnique.mockResolvedValueOnce(null);

    await applyOrderPaidEffects(
      prismaMock,
      { ...BASE_ORDER, customerPhone: '+15550001111', customerName: 'Amara' },
      {},
    );

    expect(prismaMock.customer.create).toHaveBeenCalledWith({
      data: {
        storeId: 'store-1',
        phone: '+15550001111',
        ordersCount: 1,
        totalSpentCents: 3600,
        name: 'Amara',
        email: 'buyer@example.com',
      },
    });
  });

  it('enqueues notification.order_paid and email.order_confirmation outbox events', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});

    const kinds = prismaMock.outboxEvent.create.mock.calls.map(
      (c) => (c[0] as { data: { kind: string } }).data.kind,
    );
    expect(kinds).toContain('notification.order_paid');
    expect(kinds).toContain('email.order_confirmation');
  });

  it('applies the Phase 12 PRO commission discount when the store is on PRO', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'PRO',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);
    prismaMock.platformSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      commissionRateBp: 600,
      commissionRateBpPro: 300,
      updatedAt: new Date(),
    } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({ commissionAmount: 108, netAmount: 3492 }),
    });
  });
});
