import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import {
  mapStripeDisputeStatus,
  handleDisputeCreated,
  handleDisputeUpdated,
  handleDisputeClosed,
} from './disputes';

function fakeDispute(overrides: Partial<Stripe.Dispute> = {}): Stripe.Dispute {
  return {
    id: 'dp_test_1',
    object: 'dispute',
    amount: 3600,
    currency: 'usd',
    charge: 'ch_test_1',
    payment_intent: 'pi_test_1',
    reason: 'fraudulent',
    status: 'needs_response',
    evidence_details: { due_by: 1893456000 } as never,
    ...overrides,
  } as Stripe.Dispute;
}

beforeEach(() => {
  prismaMock.order.findFirst.mockResolvedValue({ id: 'order-1', storeId: 'store-1' } as never);
  prismaMock.dispute.findUnique.mockResolvedValue(null);
  prismaMock.dispute.create.mockResolvedValue({ id: 'dispute-row-1' } as never);
  prismaMock.dispute.update.mockResolvedValue({ id: 'dispute-row-1' } as never);
  prismaMock.financialEvent.findUnique.mockResolvedValue(null);
  prismaMock.financialEvent.create.mockResolvedValue({ id: 'fe-1' } as never);
});

describe('mapStripeDisputeStatus', () => {
  it.each([
    ['needs_response', 'NEEDS_RESPONSE'],
    ['warning_needs_response', 'NEEDS_RESPONSE'],
    ['under_review', 'UNDER_REVIEW'],
    ['warning_under_review', 'UNDER_REVIEW'],
    ['won', 'WON'],
    ['lost', 'LOST'],
    ['warning_closed', 'WARNING_CLOSED'],
    ['prevented', 'WON'],
  ] as const)('maps Stripe status %s to %s', (stripeStatus, expected) => {
    expect(mapStripeDisputeStatus(stripeStatus)).toBe(expected);
  });

  it('falls back to UNDER_REVIEW for an unrecognized future status', () => {
    expect(mapStripeDisputeStatus('some_future_status' as Stripe.Dispute.Status)).toBe(
      'UNDER_REVIEW',
    );
  });
});

describe('handleDisputeCreated', () => {
  it('creates a Dispute row with status NEEDS_RESPONSE, amount, currency, reason, evidenceDueBy', async () => {
    await handleDisputeCreated(prismaMock, fakeDispute());
    expect(prismaMock.dispute.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        storeId: 'store-1',
        stripeDisputeId: 'dp_test_1',
        amountCents: 3600,
        currency: 'USD',
        reason: 'fraudulent',
        status: 'NEEDS_RESPONSE',
        evidenceDueBy: new Date(1893456000 * 1000),
      },
      select: { id: true },
    });
  });

  it('writes a DISPUTE_OPENED FinancialEvent with a negative amount', async () => {
    await handleDisputeCreated(prismaMock, fakeDispute());
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'DISPUTE_OPENED',
        sourceType: 'Dispute',
        sourceId: 'dispute-row-1',
        orderId: 'order-1',
        storeId: 'store-1',
        amountCents: -3600,
        externalId: 'dp_test_1',
      }),
    });
  });

  it('does not mutate Order.status', async () => {
    await handleDisputeCreated(prismaMock, fakeDispute());
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('a duplicate charge.dispute.created (retry) does not write a second FinancialEvent', async () => {
    prismaMock.financialEvent.findUnique.mockResolvedValueOnce({ id: 'fe-existing' } as never);
    await handleDisputeCreated(prismaMock, fakeDispute());
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('logs and skips without creating an orphan Dispute when no Order matches the payment_intent', async () => {
    prismaMock.order.findFirst.mockResolvedValueOnce(null);
    await handleDisputeCreated(prismaMock, fakeDispute());
    expect(prismaMock.dispute.create).not.toHaveBeenCalled();
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('logs and skips when the dispute carries no payment_intent', async () => {
    await handleDisputeCreated(prismaMock, fakeDispute({ payment_intent: null }));
    expect(prismaMock.order.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.dispute.create).not.toHaveBeenCalled();
  });

  it('handles a Connect order (destination charge) identically — no stripeAccount / extra Stripe call involved', async () => {
    prismaMock.order.findFirst.mockResolvedValueOnce({
      id: 'order-connect-1',
      storeId: 'store-2',
    } as never);
    await handleDisputeCreated(prismaMock, fakeDispute());
    expect(prismaMock.dispute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orderId: 'order-connect-1', storeId: 'store-2' }),
      }),
    );
  });
});

describe('handleDisputeUpdated', () => {
  it('updates the existing Dispute row to the new status', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'NEEDS_RESPONSE',
    } as never);
    await handleDisputeUpdated(prismaMock, fakeDispute({ status: 'under_review' }));
    expect(prismaMock.dispute.update).toHaveBeenCalledWith({
      where: { id: 'dispute-row-1' },
      data: expect.objectContaining({ status: 'UNDER_REVIEW' }),
    });
  });

  it('writes a DISPUTE_UPDATED event keyed on dispute id + new status', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'NEEDS_RESPONSE',
    } as never);
    await handleDisputeUpdated(prismaMock, fakeDispute({ status: 'under_review' }));
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'DISPUTE_UPDATED',
        sourceType: 'Dispute',
        sourceId: 'dispute-row-1:UNDER_REVIEW',
      }),
    });
  });

  it('a duplicate update reporting the SAME status writes no new FinancialEvent (idempotent)', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'UNDER_REVIEW',
    } as never);
    prismaMock.financialEvent.findUnique.mockResolvedValueOnce({ id: 'fe-existing' } as never);
    await handleDisputeUpdated(prismaMock, fakeDispute({ status: 'under_review' }));
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('a genuinely different status transition writes its OWN new FinancialEvent (not blocked by the earlier one)', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'NEEDS_RESPONSE',
    } as never);
    // No existing FinancialEvent for (DISPUTE_UPDATED, Dispute, "dispute-row-1:UNDER_REVIEW")
    await handleDisputeUpdated(prismaMock, fakeDispute({ status: 'under_review' }));
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceId: 'dispute-row-1:UNDER_REVIEW' }),
    });
  });

  it('self-heals when `updated` arrives before `created` (no existing Dispute row)', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce(null);
    await handleDisputeUpdated(prismaMock, fakeDispute({ status: 'under_review' }));
    expect(prismaMock.dispute.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'UNDER_REVIEW' }),
      }),
    );
  });

  it('never regresses status — a stale NEEDS_RESPONSE payload cannot walk back an UNDER_REVIEW row', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'UNDER_REVIEW',
    } as never);
    await handleDisputeUpdated(prismaMock, fakeDispute({ status: 'needs_response' }));
    expect(prismaMock.dispute.update).toHaveBeenCalledWith({
      where: { id: 'dispute-row-1' },
      data: expect.objectContaining({ status: 'UNDER_REVIEW' }),
    });
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sourceId: 'dispute-row-1:UNDER_REVIEW' }),
    });
  });

  it('does not mutate Order.status', async () => {
    await handleDisputeUpdated(prismaMock, fakeDispute({ status: 'under_review' }));
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });
});

describe('handleDisputeClosed', () => {
  it('updates the Dispute to its terminal status', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'UNDER_REVIEW',
    } as never);
    await handleDisputeClosed(prismaMock, fakeDispute({ status: 'lost' }));
    expect(prismaMock.dispute.update).toHaveBeenCalledWith({
      where: { id: 'dispute-row-1' },
      data: expect.objectContaining({ status: 'LOST' }),
    });
  });

  it('writes a DISPUTE_CLOSED event', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'UNDER_REVIEW',
    } as never);
    await handleDisputeClosed(prismaMock, fakeDispute({ status: 'won' }));
    expect(prismaMock.financialEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'DISPUTE_CLOSED',
        sourceType: 'Dispute',
        sourceId: 'dispute-row-1',
      }),
    });
  });

  it('a replayed charge.dispute.closed does not write a second FinancialEvent', async () => {
    prismaMock.dispute.findUnique.mockResolvedValueOnce({
      id: 'dispute-row-1',
      status: 'LOST',
    } as never);
    prismaMock.financialEvent.findUnique.mockResolvedValueOnce({ id: 'fe-existing' } as never);
    await handleDisputeClosed(prismaMock, fakeDispute({ status: 'lost' }));
    expect(prismaMock.financialEvent.create).not.toHaveBeenCalled();
  });

  it('does not mutate Order.status, and creates no withdrawal or payout', async () => {
    await handleDisputeClosed(prismaMock, fakeDispute({ status: 'lost' }));
    expect(prismaMock.order.update).not.toHaveBeenCalled();
    expect(prismaMock.withdrawal.create).not.toHaveBeenCalled();
  });
});
