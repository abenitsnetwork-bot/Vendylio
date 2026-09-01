import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { NextRequest } from 'next/server';

const webhookLogFindUnique = vi.fn();
const webhookLogCreate = vi.fn();
const webhookLogUpdate = vi.fn();
const storeFindUnique = vi.fn();
const storeUpdate = vi.fn();
const commissionChargeUpdateMany = vi.fn(async () => ({ count: 0 }));

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: {
      findUnique: webhookLogFindUnique,
      create: webhookLogCreate,
      update: webhookLogUpdate,
    },
    store: { findUnique: storeFindUnique, update: storeUpdate },
    commissionCharge: { updateMany: commissionChargeUpdateMany },
  }),
);

vi.mock('@/lib/server/prisma', () => ({ prisma: { $transaction } }));

const promoteSetupIntentCard = vi.fn(async () => true);
vi.mock('@/lib/server/billing/stripe-billing', () => ({
  promoteSetupIntentCard: (...a: unknown[]) => promoteSetupIntentCard(...(a as [])),
}));

function lastUpdateData(): Record<string, unknown> {
  const call = storeUpdate.mock.calls.at(-1);
  if (!call) throw new Error('store.update was not called');
  return (call[0] as { data: Record<string, unknown> }).data;
}

const SECRET = 'test-billing-webhook-secret';

function billingEvent(opts: { type: string; object: Record<string, unknown>; eventId?: string }) {
  const event = {
    id: opts.eventId ?? 'evt_billing_1',
    object: 'event',
    type: opts.type,
    data: { object: opts.object },
  };
  const payload = JSON.stringify(event);
  const stripe = new Stripe('sk_test_fixture');
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const req = new NextRequest('http://localhost/api/webhooks/stripe-billing', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: Buffer.from(payload) as unknown as BodyInit,
  });
  return { req, event };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    items: { data: [{ current_period_end: 1_900_000_000 }] },
    metadata: { storeId: 'store-1' },
    ...overrides,
  };
}

beforeEach(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('STRIPE_BILLING_WEBHOOK_SECRET', SECRET);
  const { __resetStripeBillingWebhookProvider } =
    await import('@/lib/server/webhook/stripe-billing');
  __resetStripeBillingWebhookProvider();
  webhookLogFindUnique.mockReset().mockResolvedValue(null);
  webhookLogCreate.mockReset();
  webhookLogUpdate.mockReset();
  storeFindUnique.mockReset();
  storeUpdate.mockReset();
  commissionChargeUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  promoteSetupIntentCard.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/webhooks/stripe-billing', () => {
  it('subscription.created for an active sub → plan PRO / planSource SUBSCRIPTION', async () => {
    storeFindUnique.mockResolvedValueOnce({ id: 'store-1', plan: 'FREE', planSource: null });
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'customer.subscription.created',
      object: subscription(),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(storeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'store-1' },
        data: expect.objectContaining({ plan: 'PRO', planSource: 'SUBSCRIPTION' }),
      }),
    );
  });

  it('subscription.updated past_due → status recorded, plan NOT downgraded', async () => {
    storeFindUnique.mockResolvedValueOnce({
      id: 'store-1',
      plan: 'PRO',
      planSource: 'SUBSCRIPTION',
    });
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'customer.subscription.updated',
      object: subscription({ status: 'past_due' }),
    });
    await POST(req);
    const data = lastUpdateData();
    expect(data.subscriptionStatus).toBe('PAST_DUE');
    expect(data.plan).toBeUndefined();
    expect(data.planSource).toBeUndefined();
  });

  it('subscription.deleted → plan FREE when planSource was SUBSCRIPTION', async () => {
    storeFindUnique.mockResolvedValueOnce({
      id: 'store-1',
      plan: 'PRO',
      planSource: 'SUBSCRIPTION',
    });
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'customer.subscription.deleted',
      object: subscription({ status: 'canceled' }),
    });
    await POST(req);
    const data = lastUpdateData();
    expect(data.plan).toBe('FREE');
    expect(data.planSource).toBeNull();
  });

  it('invoice.payment_failed → marks the store PAST_DUE by customer id', async () => {
    storeFindUnique.mockResolvedValueOnce({ id: 'store-1', planSource: 'SUBSCRIPTION' });
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'invoice.payment_failed',
      object: { id: 'in_1', object: 'invoice', customer: 'cus_1' },
    });
    await POST(req);
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
  });

  it('a replayed event short-circuits as deduped (no store write)', async () => {
    webhookLogFindUnique.mockResolvedValueOnce({ id: 'wl_1', processedAt: new Date() });
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'customer.subscription.created',
      object: subscription(),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(body.deduped).toBe(true);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('rejects a bad signature with 401', async () => {
    const { req } = billingEvent({
      type: 'customer.subscription.created',
      object: subscription(),
    });
    const tampered = new NextRequest('http://localhost/api/webhooks/stripe-billing', {
      method: 'POST',
      headers: req.headers,
      body: Buffer.from(JSON.stringify({ id: 'evt_x' })) as unknown as BodyInit,
    });
    const { POST } = await import('./route');
    const res = await POST(tampered);
    expect(res.status).toBe(401);
  });

  it('an unmatched subscription is a 200 no-op', async () => {
    storeFindUnique.mockResolvedValue(null);
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'customer.subscription.created',
      object: subscription({ metadata: {} }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('invoice.paid → settles INVOICED CommissionCharge rows carrying the invoice id (Phase 1b)', async () => {
    commissionChargeUpdateMany.mockResolvedValueOnce({ count: 3 });
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'invoice.paid',
      object: { id: 'in_commission_1', object: 'invoice', customer: 'cus_1' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(commissionChargeUpdateMany).toHaveBeenCalledWith({
      where: { stripeInvoiceId: 'in_commission_1', status: 'INVOICED' },
      data: expect.objectContaining({ status: 'SETTLED' }),
    });
  });

  it('invoice.paid for a subscription-renewal invoice is a harmless no-op (0 rows)', async () => {
    commissionChargeUpdateMany.mockResolvedValueOnce({ count: 0 });
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'invoice.paid',
      object: { id: 'in_sub_renewal', object: 'invoice', customer: 'cus_1' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('checkout.session.completed (setup mode) → promotes the collected card', async () => {
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'checkout.session.completed',
      object: {
        id: 'cs_1',
        object: 'checkout.session',
        mode: 'setup',
        setup_intent: 'seti_1',
      },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(promoteSetupIntentCard).toHaveBeenCalledWith('seti_1');
  });

  it('checkout.session.completed (subscription mode) does NOT promote a card', async () => {
    const { POST } = await import('./route');
    const { req } = billingEvent({
      type: 'checkout.session.completed',
      object: { id: 'cs_2', object: 'checkout.session', mode: 'subscription' },
    });
    await POST(req);
    expect(promoteSetupIntentCard).not.toHaveBeenCalled();
  });

  it('exports runtime=nodejs and dynamic=force-dynamic', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
