// Extracted from api/webhooks/stripe/route.test.ts's Phase 2/4/6/7/12
// coverage — same assertions, now exercised directly against the shared
// function instead of only through the Stripe webhook HTTP layer.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/inventory/adjust', () => ({
  applyStockChange: vi.fn(),
}));

import { applyOrderPaidEffects, type OrderForPaidEffects } from './markPaid';
import { applyStockChange } from '@/lib/server/inventory/adjust';

const mockApplyStockChange = vi.mocked(applyStockChange);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.platformSettings.findUnique.mockResolvedValue(null); // no row yet = 0% commission
  prismaMock.customer.findUnique.mockResolvedValue(null);
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

const BASE_ORDER: OrderForPaidEffects = {
  id: 'order-1',
  storeId: 'store-1',
  provider: 'stripe_platform',
  amount: 3600,
  currency: 'USD',
  lineItems: [{ productId: 'prod-a', name: 'Shea Butter', priceCents: 1800, quantity: 2 }],
  customerPhone: null,
  customerName: null,
  customerEmail: 'buyer@example.com',
  deliveryAddress: null,
  // Default PICKUP so the existing assertions aren't affected by the Prompt #12
  // fulfillment-record creation (that path is covered separately below).
  fulfillmentMethod: 'PICKUP',
  deliveryFeeCents: 0,
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

  it('PAY-01 — records zero commission for a Cash App / Zelle order', async () => {
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

    await applyOrderPaidEffects(
      prismaMock,
      { ...BASE_ORDER, provider: 'cashapp_manual' },
      { paymentMethod: 'cashapp' },
    );

    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'PAID',
        commissionAmount: 0,
        netAmount: 3600,
      }),
    });
  });

  it('records a SALE stock movement for a lineItem with no variantId', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      defaultLowStockThreshold: 3,
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});
    expect(mockApplyStockChange).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        productId: 'prod-a',
        variantId: null,
        delta: -2,
        reason: 'SALE',
        actorType: 'SYSTEM',
        orderId: 'order-1',
        floorAtZero: true,
      }),
    );
  });

  it('targets the variant (not the product) for a lineItem with a variantId', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      defaultLowStockThreshold: 3,
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.productVariant.findUnique.mockResolvedValueOnce({ id: 'var-1' } as never);

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

    expect(mockApplyStockChange).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        productId: 'prod-a',
        variantId: 'var-1',
        delta: -2,
        reason: 'SALE',
      }),
    );
    expect(prismaMock.product.findUnique).not.toHaveBeenCalled();
  });

  it('skips a lineItem whose product no longer exists (no stock movement)', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      defaultLowStockThreshold: 3,
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce(null);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});
    expect(mockApplyStockChange).not.toHaveBeenCalled();
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

  it('enqueues email.order_new_seller (NOTIF-01) for the store owner', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});

    const sellerEmail = prismaMock.outboxEvent.create.mock.calls
      .map((c) => (c[0] as { data: { kind: string; payload: Record<string, unknown> } }).data)
      .find((d) => d.kind === 'email.order_new_seller');
    expect(sellerEmail).toBeDefined();
    expect(sellerEmail?.payload).toMatchObject({ orderId: BASE_ORDER.id });
  });

  it('enqueues notification.low_stock when a SALE crosses the low-stock threshold', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      defaultLowStockThreshold: 3,
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
    mockApplyStockChange.mockResolvedValueOnce({
      before: 4,
      after: 2,
      delta: -2,
      effectiveThreshold: 3,
      crossedLowThreshold: true,
      crossedZero: false,
    });

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});

    const lowStock = prismaMock.outboxEvent.create.mock.calls
      .map((c) => (c[0] as { data: { kind: string; payload: Record<string, unknown> } }).data)
      .find((d) => d.kind === 'notification.low_stock');
    expect(lowStock).toBeDefined();
    expect(lowStock?.payload).toMatchObject({
      userId: 'seller-1',
      productId: 'prod-a',
      productName: 'Shea Butter',
      quantity: 2,
      threshold: 3,
    });
  });

  it('enqueues notification.out_of_stock when a SALE drives stock to zero', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      defaultLowStockThreshold: 3,
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
    mockApplyStockChange.mockResolvedValueOnce({
      before: 2,
      after: 0,
      delta: -2,
      effectiveThreshold: 3,
      crossedLowThreshold: false,
      crossedZero: true,
    });

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});

    const kinds = prismaMock.outboxEvent.create.mock.calls.map(
      (c) => (c[0] as { data: { kind: string } }).data.kind,
    );
    expect(kinds).toContain('notification.out_of_stock');
    expect(kinds).not.toContain('notification.low_stock');
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

  it('bumps the promo code redemptionCount when the order carries one (Phase D)', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);

    await applyOrderPaidEffects(prismaMock, { ...BASE_ORDER, discountCode: 'FREESHIP' }, {});
    expect(prismaMock.discount.updateMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', code: 'FREESHIP' },
      data: { redemptionCount: { increment: 1 } },
    });
  });

  it('does not touch the Discount table when the order has no promo code', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      plan: 'FREE',
      organization: { ownerId: 'seller-1' },
    } as never);
    prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);

    await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});
    expect(prismaMock.discount.updateMany).not.toHaveBeenCalled();
  });

  // Prompt #12 — the fulfillment record is opened here (PENDING, no courier call).
  describe('fulfillment record', () => {
    function seedDeliveryStore(fulfillmentConfig: unknown = {}, deliveryProvider = 'self_manual') {
      prismaMock.store.findUnique.mockResolvedValueOnce({
        plan: 'FREE',
        defaultLowStockThreshold: 3,
        fulfillmentConfig,
        deliveryProvider,
        deliveryFeeCents: 500,
        organization: { ownerId: 'seller-1' },
      } as never);
      prismaMock.product.findUnique.mockResolvedValueOnce({ id: 'prod-a' } as never);
      prismaMock.delivery.upsert.mockResolvedValue({} as never);
    }

    it('opens a PENDING Delivery for a DELIVERY order (MERCHANT by default)', async () => {
      seedDeliveryStore();
      await applyOrderPaidEffects(
        prismaMock,
        { ...BASE_ORDER, fulfillmentMethod: 'DELIVERY', deliveryFeeCents: 500 },
        {},
      );
      const arg = prismaMock.delivery.upsert.mock.calls[0]?.[0];
      expect(arg?.where).toEqual({ orderId: 'order-1' });
      expect(arg?.create).toMatchObject({
        state: 'PENDING',
        providerType: 'MERCHANT',
        provider: 'self_manual',
        feeCents: 500,
      });
    });

    it('routes to UBER_DIRECT when the store config enables it', async () => {
      seedDeliveryStore({ uberDirect: { enabled: true }, merchant: { enabled: false } });
      await applyOrderPaidEffects(
        prismaMock,
        { ...BASE_ORDER, fulfillmentMethod: 'DELIVERY', deliveryFeeCents: 500 },
        {},
      );
      expect(prismaMock.delivery.upsert.mock.calls[0]?.[0]?.create).toMatchObject({
        providerType: 'UBER_DIRECT',
        provider: 'uber_direct',
      });
    });

    it('honours an explicit Order.deliveryProviderType when the store enables it', async () => {
      seedDeliveryStore({ doordash: { enabled: true } });
      await applyOrderPaidEffects(
        prismaMock,
        {
          ...BASE_ORDER,
          fulfillmentMethod: 'DELIVERY',
          deliveryFeeCents: 500,
          deliveryProviderType: 'DOORDASH',
        },
        {},
      );
      expect(prismaMock.delivery.upsert.mock.calls[0]?.[0]?.create).toMatchObject({
        providerType: 'DOORDASH',
      });
    });

    it('ignores an explicit provider the store has NOT enabled (Prompt #13 R2)', async () => {
      // DoorDash not in the config → the crafted value is dropped, the order
      // routes through the store's actual method instead of a courier the
      // merchant never switched on.
      seedDeliveryStore({ uberDirect: { enabled: true }, merchant: { enabled: false } });
      await applyOrderPaidEffects(
        prismaMock,
        {
          ...BASE_ORDER,
          fulfillmentMethod: 'DELIVERY',
          deliveryFeeCents: 500,
          deliveryProviderType: 'DOORDASH',
        },
        {},
      );
      expect(prismaMock.delivery.upsert.mock.calls[0]?.[0]?.create).toMatchObject({
        providerType: 'UBER_DIRECT',
      });
    });

    it('does NOT open a Delivery for a PICKUP order', async () => {
      prismaMock.store.findUnique.mockResolvedValueOnce({
        plan: 'FREE',
        organization: { ownerId: 'seller-1' },
      } as never);
      prismaMock.product.findUnique.mockResolvedValueOnce({ quantity: 10 } as never);
      await applyOrderPaidEffects(prismaMock, BASE_ORDER, {});
      expect(prismaMock.delivery.upsert).not.toHaveBeenCalled();
    });
  });
});
