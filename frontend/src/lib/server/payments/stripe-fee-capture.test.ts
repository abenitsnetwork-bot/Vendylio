import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prismaMock } from '@/test-utils/prisma-mock';

const { paymentIntentsRetrieve } = vi.hoisted(() => ({
  paymentIntentsRetrieve: vi.fn(),
}));

vi.mock('stripe', () => {
  class FakeStripeError extends Error {
    code?: string | undefined;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  class FakeStripe {
    paymentIntents = { retrieve: paymentIntentsRetrieve };
    static errors = { StripeError: FakeStripeError };
  }
  return { default: FakeStripe };
});

import {
  getStripeFeeForPayment,
  recordStripeFee,
  StripeFeeCaptureUnconfiguredError,
  __resetStripeFeeCaptureClient,
} from './stripe-fee-capture';

function chargeWithFee(feeCents: number, overrides: Record<string, unknown> = {}) {
  return {
    latest_charge: {
      id: 'ch_test_1',
      balance_transaction: {
        id: 'txn_test_1',
        fee: feeCents,
        currency: 'usd',
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  __resetStripeFeeCaptureClient();
  paymentIntentsRetrieve.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetStripeFeeCaptureClient();
});

describe('getStripeFeeForPayment', () => {
  it('throws StripeFeeCaptureUnconfiguredError when STRIPE_SECRET_KEY is missing', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    await expect(getStripeFeeForPayment({ paymentIntentId: 'pi_1' })).rejects.toThrow(
      StripeFeeCaptureUnconfiguredError,
    );
  });

  it('extracts fee/charge/balanceTransaction from a fully expanded PaymentIntent (platform)', async () => {
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(350));
    const res = await getStripeFeeForPayment({ paymentIntentId: 'pi_1' });
    expect(res).toEqual({
      ok: true,
      result: {
        feeCents: 350,
        chargeId: 'ch_test_1',
        balanceTransactionId: 'txn_test_1',
        currency: 'usd',
      },
    });
    expect(paymentIntentsRetrieve).toHaveBeenCalledWith('pi_1', {
      expand: ['latest_charge.balance_transaction'],
    });
  });

  it('Phase 2D.1 — never passes a stripeAccount option, even conceptually for a Connect destination charge (both live on the platform account)', async () => {
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(216));
    await getStripeFeeForPayment({ paymentIntentId: 'pi_2' });
    expect(paymentIntentsRetrieve).toHaveBeenCalledWith('pi_2', {
      expand: ['latest_charge.balance_transaction'],
    });
    // Exactly two arguments — no third stripeAccount request-options object.
    expect(paymentIntentsRetrieve.mock.calls[0]).toHaveLength(2);
  });

  it('NOT_AVAILABLE_YET when latest_charge has no balance_transaction yet', async () => {
    paymentIntentsRetrieve.mockResolvedValueOnce({
      latest_charge: { id: 'ch_test_1', balance_transaction: null },
    });
    const res = await getStripeFeeForPayment({ paymentIntentId: 'pi_1' });
    expect(res).toEqual({
      ok: false,
      error: { kind: 'NOT_AVAILABLE_YET', reason: expect.any(String) },
    });
  });

  it('NOT_AVAILABLE_YET when the PaymentIntent has no charge at all yet', async () => {
    paymentIntentsRetrieve.mockResolvedValueOnce({ latest_charge: null });
    const res = await getStripeFeeForPayment({ paymentIntentId: 'pi_1' });
    expect(res).toEqual({
      ok: false,
      error: { kind: 'NOT_AVAILABLE_YET', reason: expect.any(String) },
    });
  });

  it('NOT_FOUND (non-retryable) on a resource_missing Stripe error', async () => {
    const Stripe = (await import('stripe')).default as unknown as {
      errors: { StripeError: new (m: string, c?: string) => Error };
    };
    paymentIntentsRetrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeError('No such payment_intent', 'resource_missing'),
    );
    const res = await getStripeFeeForPayment({ paymentIntentId: 'pi_bad' });
    expect(res).toEqual({
      ok: false,
      error: { kind: 'NOT_FOUND', reason: 'No such payment_intent' },
    });
  });

  it('STRIPE_ERROR (retryable) on any other Stripe error', async () => {
    const Stripe = (await import('stripe')).default as unknown as {
      errors: { StripeError: new (m: string, c?: string) => Error };
    };
    paymentIntentsRetrieve.mockRejectedValueOnce(
      new Stripe.errors.StripeError('rate limited', 'rate_limit'),
    );
    const res = await getStripeFeeForPayment({ paymentIntentId: 'pi_1' });
    expect(res).toEqual({ ok: false, error: { kind: 'STRIPE_ERROR', reason: 'rate limited' } });
  });
});

describe('recordStripeFee', () => {
  beforeEach(() => {
    prismaMock.order.findUnique.mockReset();
    prismaMock.store.findUnique.mockReset();
    prismaMock.order.updateMany.mockReset();
    prismaMock.financialEvent.create.mockReset();
  });

  it('records the fee for a platform charge and writes one STRIPE_FEE_RECORDED event', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-1',
      storeId: 'store-1',
      provider: 'stripe_platform',
      paidAt: new Date(),
      stripeFeeCents: null,
      stripePaymentIntentId: 'pi_1',
    } as never);
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(350));
    prismaMock.order.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const outcome = await recordStripeFee(prismaMock, 'order-1');

    expect(outcome).toEqual({ status: 'RECORDED', feeCents: 350 });
    expect(paymentIntentsRetrieve).toHaveBeenCalledWith('pi_1', {
      expand: ['latest_charge.balance_transaction'],
    });
    expect(prismaMock.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', stripeFeeCents: null },
      data: { stripeFeeCents: 350 },
    });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'STRIPE_FEE_RECORDED',
        sourceType: 'Order',
        sourceId: 'order-1',
        storeId: 'store-1',
        orderId: 'order-1',
        amountCents: -350, // signed — a cost to Vendylio
        currency: 'USD',
        provider: 'stripe',
        externalId: 'txn_test_1',
        metadata: expect.objectContaining({
          paymentIntentId: 'pi_1',
          chargeId: 'ch_test_1',
          balanceTransactionId: 'txn_test_1',
        }),
      }),
    });
  });

  it('Phase 2D.1 — a stripe_connect order retrieves in the PLATFORM account context (no Store lookup, no stripeAccount option)', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-2',
      storeId: 'store-2',
      provider: 'stripe_connect',
      paidAt: new Date(),
      stripeFeeCents: null,
      stripePaymentIntentId: 'pi_2',
    } as never);
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(216));
    prismaMock.order.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const outcome = await recordStripeFee(prismaMock, 'order-2');

    expect(outcome).toEqual({ status: 'RECORDED', feeCents: 216 });
    // Destination charges live on the platform account for BOTH providers —
    // exactly two arguments, no stripeAccount request-options object, and
    // store.stripeAccountId is never even looked up.
    expect(paymentIntentsRetrieve).toHaveBeenCalledWith('pi_2', {
      expand: ['latest_charge.balance_transaction'],
    });
    expect(paymentIntentsRetrieve.mock.calls[0]).toHaveLength(2);
    expect(prismaMock.store.findUnique).not.toHaveBeenCalled();
    const call = prismaMock.financialEvent.create.mock.calls[0]![0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(call.data.metadata).not.toHaveProperty('stripeAccountId');
  });

  it('leaves the order untouched and returns RETRY_LATER when the balance transaction is not ready', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-3',
      storeId: 'store-1',
      provider: 'stripe_platform',
      paidAt: new Date(),
      stripeFeeCents: null,
      stripePaymentIntentId: 'pi_3',
    } as never);
    paymentIntentsRetrieve.mockResolvedValueOnce({
      latest_charge: { id: 'ch_3', balance_transaction: null },
    });

    const outcome = await recordStripeFee(prismaMock, 'order-3');

    expect(outcome).toEqual({ status: 'RETRY_LATER', reason: expect.any(String) });
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('skips Cash App orders entirely — no Stripe call at all', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-4',
      storeId: 'store-1',
      provider: 'cashapp_manual',
      paidAt: new Date(),
      stripeFeeCents: null,
      stripePaymentIntentId: null,
    } as never);

    const outcome = await recordStripeFee(prismaMock, 'order-4');

    expect(outcome.status).toBe('SKIPPED_NOT_APPLICABLE');
    expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
  });

  it('skips Zelle orders entirely — no Stripe call at all', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-5',
      storeId: 'store-1',
      provider: 'zelle_manual',
      paidAt: new Date(),
      stripeFeeCents: null,
      stripePaymentIntentId: null,
    } as never);

    const outcome = await recordStripeFee(prismaMock, 'order-5');

    expect(outcome.status).toBe('SKIPPED_NOT_APPLICABLE');
    expect(paymentIntentsRetrieve).not.toHaveBeenCalled();
  });

  it('is idempotent — a second capture with the same fee is a no-op (ALREADY_RECORDED)', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-6',
      storeId: 'store-1',
      provider: 'stripe_platform',
      paidAt: new Date(),
      stripeFeeCents: 350, // already recorded by an earlier attempt
      stripePaymentIntentId: 'pi_6',
    } as never);
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(350));

    const outcome = await recordStripeFee(prismaMock, 'order-6');

    expect(outcome).toEqual({ status: 'ALREADY_RECORDED' });
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('never overwrites a conflicting fee — surfaces CONFLICT instead', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-7',
      storeId: 'store-1',
      provider: 'stripe_platform',
      paidAt: new Date(),
      stripeFeeCents: 350, // recorded earlier
      stripePaymentIntentId: 'pi_7',
    } as never);
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(400)); // disagrees

    const outcome = await recordStripeFee(prismaMock, 'order-7');

    expect(outcome).toEqual({ status: 'CONFLICT', existingFeeCents: 350, newFeeCents: 400 });
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('re-checks on a lost race instead of assuming — matching value is ALREADY_RECORDED', async () => {
    prismaMock.order.findUnique
      .mockResolvedValueOnce({
        id: 'order-8',
        storeId: 'store-1',
        provider: 'stripe_platform',
        paidAt: new Date(),
        stripeFeeCents: null,
        stripePaymentIntentId: 'pi_8',
      } as never)
      .mockResolvedValueOnce({ stripeFeeCents: 350 } as never); // re-read after losing the race
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(350));
    prismaMock.order.updateMany.mockResolvedValueOnce({ count: 0 } as never); // someone else won

    const outcome = await recordStripeFee(prismaMock, 'order-8');

    expect(outcome).toEqual({ status: 'ALREADY_RECORDED' });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('Phase 2D.1 — a stripe_connect order still retrieves the fee even when the store has no stripeAccountId (no longer needed for retrieval)', async () => {
    prismaMock.order.findUnique.mockResolvedValueOnce({
      id: 'order-9',
      storeId: 'store-9',
      provider: 'stripe_connect',
      paidAt: new Date(),
      stripeFeeCents: null,
      stripePaymentIntentId: 'pi_9',
    } as never);
    paymentIntentsRetrieve.mockResolvedValueOnce(chargeWithFee(120));
    prismaMock.order.updateMany.mockResolvedValueOnce({ count: 1 } as never);

    const outcome = await recordStripeFee(prismaMock, 'order-9');

    expect(outcome).toEqual({ status: 'RECORDED', feeCents: 120 });
    expect(prismaMock.store.findUnique).not.toHaveBeenCalled();
  });
});
