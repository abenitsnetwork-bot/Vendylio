import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';

const retrieveMock = vi.fn();

// The real Stripe.errors.StripeError constructor takes a StripeRawError
// object; the mock below replaces it at runtime with a (message, code)
// constructor instead — this helper bridges the type gap for test fixtures.
const FakeStripeErrorCtor = Stripe.errors.StripeError as unknown as new (
  message: string,
  code?: string,
) => InstanceType<typeof Stripe.errors.StripeError>;

vi.mock('stripe', () => {
  class FakeStripeError extends Error {
    code?: string | undefined;
    constructor(message: string, code?: string) {
      super(message);
      this.name = 'StripeError';
      this.code = code;
    }
  }
  class FakeStripe {
    checkout = { sessions: { retrieve: retrieveMock } };
    static errors = { StripeError: FakeStripeError };
  }
  return { default: FakeStripe };
});

import {
  findEligibleOrders,
  reconcileOrder,
  runReconciliation,
  __resetStripeReconciliationClient,
  StripeReconciliationUnconfiguredError,
} from './reconciliation';

const NOW = new Date('2026-09-18T12:00:00.000Z');
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture_only');
  __resetStripeReconciliationClient();
  retrieveMock.mockReset();
  prismaMock.order.findMany.mockReset();
  prismaMock.financialEvent.findUnique.mockReset().mockResolvedValue(null);
  prismaMock.financialEvent.create.mockReset().mockResolvedValue({ id: 'fe-1' } as never);
  // reconcileOrder opens its own small transaction around the discrepancy
  // write (it isn't nested inside a caller-provided tx like Phase 2E's
  // writers are) — run the callback against prismaMock itself so the
  // financialEvent assertions below see the write.
  prismaMock.$transaction.mockImplementation((fn: unknown) =>
    (fn as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('findEligibleOrders', () => {
  it('queries stripe_platform/stripe_connect orders with status PENDING or EXPIRED, a non-null providerChargeId, inside the 7-day expiresAt window', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    await findEligibleOrders(prismaMock, { now: NOW });
    expect(prismaMock.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider: { in: ['stripe_platform', 'stripe_connect'] },
          status: { in: ['PENDING', 'EXPIRED'] },
          providerChargeId: { not: null },
          expiresAt: { lt: NOW, gte: new Date(NOW.getTime() - SEVEN_DAYS_MS) },
        },
      }),
    );
  });

  it('an expired PENDING order falls inside the window (eligible)', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    await findEligibleOrders(prismaMock, { now: NOW });
    const call = prismaMock.order.findMany.mock.calls[0]![0] as {
      where: { status: { in: string[] }; expiresAt: { lt: Date; gte: Date } };
    };
    expect(call.where.status.in).toContain('PENDING');
    const expiredOneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(expiredOneHourAgo.getTime()).toBeLessThan(call.where.expiresAt.lt.getTime());
    expect(expiredOneHourAgo.getTime()).toBeGreaterThanOrEqual(call.where.expiresAt.gte.getTime());
  });

  it('a recently EXPIRED order falls inside the window (eligible)', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    await findEligibleOrders(prismaMock, { now: NOW });
    const call = prismaMock.order.findMany.mock.calls[0]![0] as {
      where: { status: { in: string[] }; expiresAt: { lt: Date; gte: Date } };
    };
    expect(call.where.status.in).toContain('EXPIRED');
    const expiredOneDayAgo = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(expiredOneDayAgo.getTime()).toBeLessThan(call.where.expiresAt.lt.getTime());
    expect(expiredOneDayAgo.getTime()).toBeGreaterThanOrEqual(call.where.expiresAt.gte.getTime());
  });

  it('an EXPIRED order more than 7 days past expiresAt falls outside the window (excluded)', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    await findEligibleOrders(prismaMock, { now: NOW });
    const call = prismaMock.order.findMany.mock.calls[0]![0] as {
      where: { expiresAt: { gte: Date } };
    };
    const expiredEightDaysAgo = new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000);
    expect(expiredEightDaysAgo.getTime()).toBeLessThan(call.where.expiresAt.gte.getTime());
  });

  it('a PENDING order not yet expired falls outside the window (excluded)', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    await findEligibleOrders(prismaMock, { now: NOW });
    const call = prismaMock.order.findMany.mock.calls[0]![0] as {
      where: { expiresAt: { lt: Date } };
    };
    const expiresInOneHour = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(expiresInOneHour.getTime()).toBeGreaterThanOrEqual(call.where.expiresAt.lt.getTime());
  });

  it('does not include PAID, CANCELLED, REFUNDED, or any other status in the filter', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    await findEligibleOrders(prismaMock, { now: NOW });
    const call = prismaMock.order.findMany.mock.calls[0]![0] as {
      where: { status: { in: string[] } };
    };
    expect(call.where.status.in).toEqual(['PENDING', 'EXPIRED']);
  });

  it('narrows providerChargeId to a plain string for the returned rows', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      {
        id: 'order-1',
        storeId: 'store-1',
        provider: 'stripe_platform',
        status: 'PENDING',
        amount: 3600,
        currency: 'USD',
        providerChargeId: 'cs_test_1',
        expiresAt: new Date('2026-09-17T00:00:00.000Z'),
      },
    ] as never);
    const rows = await findEligibleOrders(prismaMock, { now: NOW });
    expect(rows[0]!.providerChargeId).toBe('cs_test_1');
  });
});

const PENDING_ORDER = {
  id: 'order-1',
  storeId: 'store-1',
  provider: 'stripe_platform',
  status: 'PENDING',
  amount: 3600,
  currency: 'USD',
  providerChargeId: 'cs_test_1',
  expiresAt: new Date('2026-09-17T00:00:00.000Z'),
};

const EXPIRED_ORDER = { ...PENDING_ORDER, id: 'order-2', status: 'EXPIRED' };

describe('reconcileOrder', () => {
  it('retrieves the Checkout Session with no stripeAccount option (destination charges keep it on the platform account)', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'unpaid' });
    await reconcileOrder(prismaMock, PENDING_ORDER);
    expect(retrieveMock).toHaveBeenCalledWith('cs_test_1');
  });

  it('a stripe_connect order is retrieved identically — no stripeAccount option', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'unpaid' });
    await reconcileOrder(prismaMock, { ...PENDING_ORDER, provider: 'stripe_connect' });
    expect(retrieveMock).toHaveBeenCalledWith('cs_test_1');
  });

  it('a stripe_connect EXPIRED order is also retrieved with no stripeAccount option', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'unpaid' });
    await reconcileOrder(prismaMock, { ...EXPIRED_ORDER, provider: 'stripe_connect' });
    expect(retrieveMock).toHaveBeenCalledWith('cs_test_1');
  });

  it('PENDING + Stripe paid creates a RECONCILIATION_DISCREPANCY with reason STRIPE_PAID_VENDYLIO_PENDING', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_test_1' });
    const outcome = await reconcileOrder(prismaMock, PENDING_ORDER);
    expect(outcome).toEqual({ status: 'DISCREPANCY_RECORDED' });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'RECONCILIATION_DISCREPANCY',
        sourceType: 'Order',
        sourceId: 'order-1',
        amountCents: 3600,
        currency: 'USD',
        provider: 'stripe_platform',
        externalId: 'pi_test_1',
        metadata: expect.objectContaining({
          reason: 'STRIPE_PAID_VENDYLIO_PENDING',
          checkoutSessionId: 'cs_test_1',
          paymentIntentId: 'pi_test_1',
          stripePaymentStatus: 'paid',
          orderStatus: 'PENDING',
        }),
      }),
    });
  });

  it('EXPIRED + Stripe paid creates a RECONCILIATION_DISCREPANCY with reason STRIPE_PAID_VENDYLIO_EXPIRED', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_test_2' });
    const outcome = await reconcileOrder(prismaMock, EXPIRED_ORDER);
    expect(outcome).toEqual({ status: 'DISCREPANCY_RECORDED' });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'RECONCILIATION_DISCREPANCY',
        sourceType: 'Order',
        sourceId: 'order-2',
        metadata: expect.objectContaining({
          reason: 'STRIPE_PAID_VENDYLIO_EXPIRED',
          orderStatus: 'EXPIRED',
        }),
      }),
    });
  });

  it('EXPIRED + Stripe unpaid ("normal expired checkout") is NOT a discrepancy', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'unpaid' });
    const outcome = await reconcileOrder(prismaMock, EXPIRED_ORDER);
    expect(outcome).toEqual({ status: 'NO_DISCREPANCY', stripePaymentStatus: 'unpaid' });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('PENDING + Stripe unpaid is NOT a discrepancy', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'unpaid' });
    const outcome = await reconcileOrder(prismaMock, PENDING_ORDER);
    expect(outcome).toEqual({ status: 'NO_DISCREPANCY', stripePaymentStatus: 'unpaid' });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('EXPIRED + Stripe no_payment_required is NOT treated as paid', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'no_payment_required' });
    const outcome = await reconcileOrder(prismaMock, EXPIRED_ORDER);
    expect(outcome).toEqual({
      status: 'NO_DISCREPANCY',
      stripePaymentStatus: 'no_payment_required',
    });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('PENDING + Stripe no_payment_required is NOT treated as paid', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'no_payment_required' });
    const outcome = await reconcileOrder(prismaMock, PENDING_ORDER);
    expect(outcome).toEqual({
      status: 'NO_DISCREPANCY',
      stripePaymentStatus: 'no_payment_required',
    });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('a Stripe "resource_missing" error is classified NOT_FOUND and creates no discrepancy', async () => {
    retrieveMock.mockRejectedValueOnce(
      new FakeStripeErrorCtor('no such session', 'resource_missing'),
    );
    const outcome = await reconcileOrder(prismaMock, PENDING_ORDER);
    expect(outcome).toEqual({ status: 'NOT_FOUND' });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('a generic Stripe API error is classified STRIPE_ERROR and creates no false discrepancy', async () => {
    retrieveMock.mockRejectedValueOnce(new FakeStripeErrorCtor('rate limited', 'rate_limit'));
    const outcome = await reconcileOrder(prismaMock, PENDING_ORDER);
    expect(outcome.status).toBe('STRIPE_ERROR');
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('is idempotent — a duplicate discrepancy is a no-op (ALREADY_RECORDED)', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_test_1' });
    prismaMock.financialEvent.findUnique.mockResolvedValueOnce({ id: 'fe-existing' } as never);
    const outcome = await reconcileOrder(prismaMock, PENDING_ORDER);
    expect(outcome).toEqual({ status: 'ALREADY_RECORDED' });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('running reconciliation twice on the same discrepancy: first run creates the event, second run creates no duplicate', async () => {
    // Simulate the DB actually gaining the row after the first run.
    let stored: { id: string } | null = null;
    prismaMock.financialEvent.findUnique.mockImplementation((() =>
      Promise.resolve(stored)) as never);
    prismaMock.financialEvent.create.mockImplementation((() => {
      stored = { id: 'fe-1' };
      return Promise.resolve(stored);
    }) as never);
    retrieveMock.mockResolvedValue({ payment_status: 'paid', payment_intent: 'pi_test_1' });

    const first = await reconcileOrder(prismaMock, PENDING_ORDER);
    const second = await reconcileOrder(prismaMock, PENDING_ORDER);

    expect(first).toEqual({ status: 'DISCREPANCY_RECORDED' });
    expect(second).toEqual({ status: 'ALREADY_RECORDED' });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledTimes(1);
  });

  it('never mutates Order.status, paidAt, commissionAmount, netAmount, stripePaymentIntentId, CommissionCharge, or Withdrawal', async () => {
    retrieveMock.mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_test_1' });
    await reconcileOrder(prismaMock, EXPIRED_ORDER);
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.commissionCharge.create).not.toHaveBeenCalled();
    expect(prismaMock.commissionCharge.upsert).not.toHaveBeenCalled();
    expect(prismaMock.withdrawal.create).not.toHaveBeenCalled();
  });

  it('throws StripeReconciliationUnconfiguredError when STRIPE_SECRET_KEY is missing', async () => {
    vi.unstubAllEnvs();
    __resetStripeReconciliationClient();
    await expect(reconcileOrder(prismaMock, PENDING_ORDER)).rejects.toThrow(
      StripeReconciliationUnconfiguredError,
    );
  });
});

describe('runReconciliation', () => {
  it('aggregates outcomes across a batch (mixing PENDING and EXPIRED orders) and continues past a bad order', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([
      { ...PENDING_ORDER, id: 'order-1' },
      { ...EXPIRED_ORDER, id: 'order-2' },
      { ...PENDING_ORDER, id: 'order-3' },
    ] as never);
    retrieveMock
      .mockResolvedValueOnce({ payment_status: 'paid', payment_intent: 'pi_1' }) // order-1 -> discrepancy
      .mockRejectedValueOnce(new Error('boom — unexpected non-Stripe error')) // order-2 -> skipped, batch continues
      .mockResolvedValueOnce({ payment_status: 'unpaid' }); // order-3 -> no discrepancy

    const summary = await runReconciliation(prismaMock, { now: NOW });

    expect(summary).toEqual({
      eligibleOrders: 3,
      checkedOrders: 2,
      paidDiscrepancies: 1,
      alreadyRecorded: 0,
      stripeErrors: 0,
      notFound: 0,
      skipped: 1,
    });
  });

  it('returns all-zero summary when there are no eligible orders', async () => {
    prismaMock.order.findMany.mockResolvedValueOnce([]);
    const summary = await runReconciliation(prismaMock, { now: NOW });
    expect(summary).toEqual({
      eligibleOrders: 0,
      checkedOrders: 0,
      paidDiscrepancies: 0,
      alreadyRecorded: 0,
      stripeErrors: 0,
      notFound: 0,
      skipped: 0,
    });
  });
});
