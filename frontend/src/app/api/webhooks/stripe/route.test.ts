import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { stripeFixtureRequest } from '@/test-utils/stripe-mock';

const webhookLogFindUnique = vi.fn();
const webhookLogCreate = vi.fn();
const webhookLogUpdate = vi.fn();
const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const productFindUnique = vi.fn();
const productUpdate = vi.fn();
const storeFindUnique = vi.fn();
const outboxCreate = vi.fn();
const orderStatusEventCreate = vi.fn();
const customerFindUnique = vi.fn();
const customerCreate = vi.fn();
const customerUpdate = vi.fn();
const productVariantFindUnique = vi.fn();
const productVariantUpdate = vi.fn();
const platformSettingsFindUnique = vi.fn();
const deliveryUpsert = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: {
      findUnique: webhookLogFindUnique,
      create: webhookLogCreate,
      update: webhookLogUpdate,
    },
    order: { findFirst: orderFindFirst, update: orderUpdate },
    product: { findUnique: productFindUnique, update: productUpdate },
    productVariant: { findUnique: productVariantFindUnique, update: productVariantUpdate },
    store: { findUnique: storeFindUnique },
    platformSettings: { findUnique: platformSettingsFindUnique },
    outboxEvent: { create: outboxCreate },
    orderStatusEvent: { create: orderStatusEventCreate },
    customer: { findUnique: customerFindUnique, create: customerCreate, update: customerUpdate },
    delivery: { upsert: deliveryUpsert },
  }),
);

vi.mock('@/lib/server/prisma', () => ({
  prisma: { $transaction },
}));

// applyStockChange (product/variant quantity + StockMovement ledger) is
// unit-tested on its own — here we just assert markPaid asked for the right
// decrement.
const applyStockChange = vi.fn();
vi.mock('@/lib/server/inventory/adjust', () => ({
  applyStockChange: (...args: unknown[]) => applyStockChange(...args),
}));

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture_only');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'test-webhook-secret');
  platformSettingsFindUnique.mockReset().mockResolvedValue(null); // no row yet = 0% commission
  webhookLogFindUnique.mockReset().mockResolvedValue(null);
  webhookLogCreate.mockReset();
  webhookLogUpdate.mockReset();
  orderFindFirst.mockReset();
  orderUpdate.mockReset();
  productFindUnique.mockReset();
  productUpdate.mockReset();
  storeFindUnique.mockReset();
  outboxCreate.mockReset();
  orderStatusEventCreate.mockReset();
  customerFindUnique.mockReset().mockResolvedValue(null);
  customerCreate.mockReset();
  customerUpdate.mockReset();
  productVariantFindUnique.mockReset();
  productVariantUpdate.mockReset();
  applyStockChange.mockReset().mockResolvedValue({
    before: 0,
    after: 0,
    delta: 0,
    effectiveThreshold: 3,
    crossedLowThreshold: false,
    crossedZero: false,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const PAID_ORDER = {
  id: 'order-1',
  storeId: 'store-1',
  status: 'PENDING',
  amount: 3600,
  currency: 'USD',
  customerEmail: 'buyer@example.com',
  lineItems: [{ productId: 'prod-a', name: 'Shea Butter', priceCents: 1800, quantity: 2 }],
  // PICKUP so these payment-side-effect assertions aren't entangled with the
  // Prompt #12 fulfillment-record creation (covered in markPaid.test.ts).
  fulfillmentMethod: 'PICKUP',
  deliveryFeeCents: 0,
};

describe('POST /api/webhooks/stripe', () => {
  it('valid signature + first delivery returns 200 deduped:false', async () => {
    orderFindFirst.mockResolvedValueOnce(null); // unknown session — onPaid drops
    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduped: false });
    expect(webhookLogCreate).toHaveBeenCalled();
  });

  it('replay of the same event id returns deduped:true', async () => {
    webhookLogFindUnique.mockResolvedValueOnce({ id: 'wl1', processedAt: new Date() });
    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deduped: true });
    expect(webhookLogCreate).not.toHaveBeenCalled();
  });

  it('tampered body returns 401', async () => {
    const { stripeFixture } = await import('@/test-utils/stripe-mock');
    const { rawBody, headers } = stripeFixture();
    const tampered = Buffer.from(rawBody.toString('utf8').replace('paid', 'unpaid'));
    const { POST } = await import('./route');
    const { NextRequest } = await import('next/server');
    const req = new NextRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers,
      body: tampered as unknown as BodyInit,
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('marks the Order PAID, computes commission, decrements stock, and enqueues both outbox events', async () => {
    orderFindFirst.mockResolvedValueOnce(PAID_ORDER);
    productFindUnique.mockResolvedValueOnce({ quantity: 10 });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });
    outboxCreate.mockResolvedValue({ id: 'ob1' });
    platformSettingsFindUnique.mockResolvedValueOnce({
      commissionRateBp: 600,
      commissionRateBpPro: null,
    }); // 6%

    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        status: 'PAID',
        commissionAmount: 216, // floor(3600 * 600 / 10000)
        netAmount: 3384,
        paymentMethod: 'card',
      }),
    });

    expect(applyStockChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        productId: 'prod-a',
        delta: -2,
        reason: 'SALE',
        floorAtZero: true,
      }),
    );

    expect(orderStatusEventCreate).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'PAID', actorType: 'SYSTEM' },
    });

    const kinds = outboxCreate.mock.calls.map(
      (c) => (c[0] as { data: { kind: string } }).data.kind,
    );
    expect(kinds).toContain('notification.order_paid');
    expect(kinds).toContain('email.order_confirmation');

    const notifPayloadCall = outboxCreate.mock.calls.find(
      (c) => (c[0] as { data: { kind: string } }).data.kind === 'notification.order_paid',
    );
    const notifPayload = (notifPayloadCall![0] as { data: { payload: { userId: string } } }).data
      .payload;
    expect(notifPayload.userId).toBe('seller-1');
  });

  it('Phase 12 — a PRO store gets the discounted commissionRateBpPro rate', async () => {
    orderFindFirst.mockResolvedValueOnce(PAID_ORDER);
    productFindUnique.mockResolvedValueOnce({ quantity: 10 });
    storeFindUnique.mockResolvedValueOnce({ plan: 'PRO', organization: { ownerId: 'seller-1' } });
    outboxCreate.mockResolvedValue({ id: 'ob1' });
    platformSettingsFindUnique.mockResolvedValueOnce({
      commissionRateBp: 600,
      commissionRateBpPro: 300,
    }); // 6% base, 3% PRO

    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    await POST(req);

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        commissionAmount: 108, // floor(3600 * 300 / 10000)
        netAmount: 3492,
      }),
    });
  });

  it('Phase 12 — a PRO store falls back to the base rate when commissionRateBpPro is unset', async () => {
    orderFindFirst.mockResolvedValueOnce(PAID_ORDER);
    productFindUnique.mockResolvedValueOnce({ quantity: 10 });
    storeFindUnique.mockResolvedValueOnce({ plan: 'PRO', organization: { ownerId: 'seller-1' } });
    outboxCreate.mockResolvedValue({ id: 'ob1' });
    platformSettingsFindUnique.mockResolvedValueOnce({
      commissionRateBp: 600,
      commissionRateBpPro: null,
    });

    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    await POST(req);

    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: expect.objectContaining({
        commissionAmount: 216, // same as a FREE store — no discount configured
        netAmount: 3384,
      }),
    });
  });

  it('asks applyStockChange to floor stock at 0 rather than going negative', async () => {
    orderFindFirst.mockResolvedValueOnce(PAID_ORDER);
    productFindUnique.mockResolvedValueOnce({ id: 'prod-a' });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });

    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    await POST(req);

    expect(applyStockChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: 'prod-a', delta: -2, floorAtZero: true }),
    );
  });

  it('decrements the variant (not the product) when a lineItem carries a variantId (Phase 7)', async () => {
    orderFindFirst.mockResolvedValueOnce({
      ...PAID_ORDER,
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
    productVariantFindUnique.mockResolvedValueOnce({ id: 'var-1' });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });

    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    await POST(req);

    expect(applyStockChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: 'prod-a', variantId: 'var-1', delta: -2 }),
    );
    expect(productFindUnique).not.toHaveBeenCalled();
    expect(productUpdate).not.toHaveBeenCalled();
  });

  it('passes a fractional weight-unit quantity straight through to applyStockChange', async () => {
    orderFindFirst.mockResolvedValueOnce({
      ...PAID_ORDER,
      lineItems: [{ productId: 'prod-a', name: 'Ground Pepper', priceCents: 500, quantity: 12.09 }],
    });
    productFindUnique.mockResolvedValueOnce({ id: 'prod-a' });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });

    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    await POST(req);

    expect(applyStockChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: 'prod-a', delta: -12.09 }),
    );
  });

  it('does NOT fulfil when session.amount_total disagrees with order.amount (financial-integrity gate)', async () => {
    orderFindFirst.mockResolvedValueOnce(PAID_ORDER); // order.amount = 3600
    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest({ amountTotal: 9999 });
    const res = await POST(req);

    expect(res.status).toBe(200); // acknowledged so Stripe stops retrying
    expect(orderUpdate).not.toHaveBeenCalled(); // order stays PENDING
    expect(applyStockChange).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('does NOT fulfil when session.payment_status is not "paid" (financial-integrity gate)', async () => {
    orderFindFirst.mockResolvedValueOnce(PAID_ORDER);
    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest({ paymentStatus: 'unpaid' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('is a no-op when the Order is already past PENDING (defense-in-depth alongside WebhookLog dedup)', async () => {
    orderFindFirst.mockResolvedValueOnce({ ...PAID_ORDER, status: 'PAID' });
    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('skips the email.order_confirmation event when the order has no customerEmail', async () => {
    orderFindFirst.mockResolvedValueOnce({ ...PAID_ORDER, customerEmail: null });
    productFindUnique.mockResolvedValueOnce({ quantity: 10 });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });

    const { POST } = await import('./route');
    const { req } = stripeFixtureRequest();
    await POST(req);

    const kinds = outboxCreate.mock.calls.map(
      (c) => (c[0] as { data: { kind: string } }).data.kind,
    );
    expect(kinds).toContain('notification.order_paid');
    expect(kinds).not.toContain('email.order_confirmation');
  });

  it('exports runtime=nodejs and dynamic=force-dynamic', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  describe('Customer directory upsert (Phase 6)', () => {
    const PAID_ORDER_WITH_PHONE = {
      ...PAID_ORDER,
      customerName: 'Amara',
      customerPhone: '+15551234567',
      deliveryAddress: { city: 'Baltimore' },
    };

    it('creates a new Customer on a first-time phone number', async () => {
      orderFindFirst.mockResolvedValueOnce(PAID_ORDER_WITH_PHONE);
      productFindUnique.mockResolvedValueOnce({ quantity: 10 });
      storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });

      const { POST } = await import('./route');
      const { req } = stripeFixtureRequest();
      await POST(req);

      expect(customerCreate).toHaveBeenCalledWith({
        data: {
          storeId: 'store-1',
          phone: '+15551234567',
          ordersCount: 1,
          totalSpentCents: 3600,
          name: 'Amara',
          email: 'buyer@example.com',
          address: { city: 'Baltimore' },
        },
      });
      expect(customerUpdate).not.toHaveBeenCalled();
    });

    it('increments ordersCount/totalSpentCents on a repeat phone number', async () => {
      orderFindFirst.mockResolvedValueOnce(PAID_ORDER_WITH_PHONE);
      productFindUnique.mockResolvedValueOnce({ quantity: 10 });
      storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });
      customerFindUnique.mockResolvedValueOnce({ id: 'cust-1' });

      const { POST } = await import('./route');
      const { req } = stripeFixtureRequest();
      await POST(req);

      expect(customerUpdate).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: {
          name: 'Amara',
          email: 'buyer@example.com',
          address: { city: 'Baltimore' },
          ordersCount: { increment: 1 },
          totalSpentCents: { increment: 3600 },
        },
      });
      expect(customerCreate).not.toHaveBeenCalled();
    });

    it('skips the Customer directory entirely when the order has no phone', async () => {
      orderFindFirst.mockResolvedValueOnce(PAID_ORDER); // no customerPhone
      productFindUnique.mockResolvedValueOnce({ quantity: 10 });
      storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });

      const { POST } = await import('./route');
      const { req } = stripeFixtureRequest();
      await POST(req);

      expect(customerFindUnique).not.toHaveBeenCalled();
      expect(customerCreate).not.toHaveBeenCalled();
      expect(customerUpdate).not.toHaveBeenCalled();
    });

    it('swallows a P2002 (email already used by a different phone) without failing the webhook', async () => {
      orderFindFirst.mockResolvedValueOnce(PAID_ORDER_WITH_PHONE);
      productFindUnique.mockResolvedValueOnce({ quantity: 10 });
      storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });
      customerCreate.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        }),
      );

      const { POST } = await import('./route');
      const { req } = stripeFixtureRequest();
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(orderUpdate).toHaveBeenCalled(); // the payment itself still succeeded
    });

    it('fails the whole webhook transaction on a non-P2002 error from the Customer upsert', async () => {
      orderFindFirst.mockResolvedValueOnce(PAID_ORDER_WITH_PHONE);
      productFindUnique.mockResolvedValueOnce({ quantity: 10 });
      storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'seller-1' } });
      customerCreate.mockRejectedValueOnce(new Error('connection reset'));

      const { POST } = await import('./route');
      const { req } = stripeFixtureRequest();
      const res = await POST(req);

      // The factory's outer try/catch (lib/server/webhook/handler.ts, PROTECTED)
      // turns any error propagating out of the Serializable transaction into a
      // 500 — an unexpected DB error here must not silently mark the webhook
      // processed, so the whole attempt (including the Order PAID write) rolls
      // back and Stripe will retry.
      expect(res.status).toBe(500);
    });
  });
});
