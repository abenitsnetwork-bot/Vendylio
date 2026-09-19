import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  writeFinancialEventOnce,
  recordPaymentSucceeded,
  recordApplicationFeeCreated,
  recordRefundCompleted,
} from './financial-events';

beforeEach(() => {
  prismaMock.financialEvent.findUnique.mockResolvedValue(null);
  prismaMock.financialEvent.create.mockResolvedValue({ id: 'fe-1' } as never);
});

describe('writeFinancialEventOnce', () => {
  it('creates the event when none exists for this identity', async () => {
    await writeFinancialEventOnce(prismaMock, {
      eventType: 'PAYMENT_SUCCEEDED',
      sourceType: 'Order',
      sourceId: 'order-1',
      amountCents: 3600,
    });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'PAYMENT_SUCCEEDED',
        sourceType: 'Order',
        sourceId: 'order-1',
        amountCents: 3600,
        currency: 'USD',
      }),
    });
  });

  it('is a no-op when an event with the same identity already exists', async () => {
    prismaMock.financialEvent.findUnique.mockResolvedValueOnce({ id: 'fe-existing' } as never);
    await writeFinancialEventOnce(prismaMock, {
      eventType: 'PAYMENT_SUCCEEDED',
      sourceType: 'Order',
      sourceId: 'order-1',
    });
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('checks identity on the composite (eventType, sourceType, sourceId)', async () => {
    await writeFinancialEventOnce(prismaMock, {
      eventType: 'DISPUTE_UPDATED',
      sourceType: 'Dispute',
      sourceId: 'dispute-1:UNDER_REVIEW',
    });
    expect(prismaMock.financialEvent.findUnique).toHaveBeenCalledWith({
      where: {
        eventType_sourceType_sourceId: {
          eventType: 'DISPUTE_UPDATED',
          sourceType: 'Dispute',
          sourceId: 'dispute-1:UNDER_REVIEW',
        },
      },
      select: { id: true },
    });
  });
});

describe('recordPaymentSucceeded', () => {
  const ORDER = {
    id: 'order-1',
    storeId: 'store-1',
    amount: 3600,
    currency: 'USD',
    provider: 'stripe_platform',
  };

  it('writes a positive amountCents matching order.amount', async () => {
    await recordPaymentSucceeded(prismaMock, ORDER, {
      stripeSessionId: 'cs_1',
      stripePaymentIntentId: 'pi_1',
    });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'PAYMENT_SUCCEEDED',
        sourceType: 'Order',
        sourceId: 'order-1',
        storeId: 'store-1',
        orderId: 'order-1',
        amountCents: 3600,
        currency: 'USD',
        provider: 'stripe_platform',
        externalId: 'pi_1',
      }),
    });
  });

  it('is idempotent — a duplicate call writes nothing', async () => {
    prismaMock.financialEvent.findUnique.mockResolvedValueOnce({ id: 'fe-existing' } as never);
    await recordPaymentSucceeded(prismaMock, ORDER);
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });
});

describe('recordApplicationFeeCreated', () => {
  const CONNECT_ORDER = {
    id: 'order-2',
    storeId: 'store-1',
    commissionAmount: 216,
    currency: 'USD',
  };

  it('uses the frozen commissionAmount, never recomputing it', async () => {
    await recordApplicationFeeCreated(prismaMock, CONNECT_ORDER, {
      stripePaymentIntentId: 'pi_2',
    });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'APPLICATION_FEE_CREATED',
        sourceType: 'Order',
        sourceId: 'order-2',
        amountCents: 216,
        provider: 'stripe',
        externalId: 'pi_2',
      }),
    });
  });
});

describe('recordRefundCompleted', () => {
  it('writes a negative amountCents (full refund only)', async () => {
    await recordRefundCompleted(prismaMock, {
      id: 'order-3',
      storeId: 'store-1',
      amount: 3600,
      currency: 'USD',
    });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'REFUND_COMPLETED',
        sourceType: 'Order',
        sourceId: 'order-3',
        amountCents: -3600,
      }),
    });
  });
});
