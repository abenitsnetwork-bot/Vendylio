// TEST-02 — companion unit test for `outbox/dispatcher.ts::drainOutbox`
// (PROTECTED lib).
//
// Asserts:
//   1. claims a PENDING row via updateMany (PROCESSING + attempts++) before
//      reading it; honors the per-row claim contract that protects against
//      multi-instance double-dispatch.
//   2. on successful dispatch, marks the row SENT with sentAt + lastError=null.
//   3. on dispatch failure with attempts < MAX_ATTEMPTS (5), marks the row
//      PENDING with `lastError` + a future `scheduledAt` (exponential backoff).
//   4. on dispatch failure with attempts >= MAX_ATTEMPTS, marks the row DEAD.
//   5. concurrent claim losing the race (claimed.count === 0) is skipped
//      without further work.
//
// Fixture kind is `email.verification_code` (generic dispatch-mechanics
// coverage — any surviving OutboxEvent variant works equally well here;
// the payment-specific kinds this test used to exercise were removed when
// the Bictorys payment infra was pruned).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';
import { drainOutbox } from './dispatcher';
import type { EmailQueue } from '../queues/email-queue';

const prismaMock = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;
const emailQueueMock = { enqueue: vi.fn() } as unknown as EmailQueue;

beforeEach(() => {
  mockReset(prismaMock);
  vi.mocked(emailQueueMock.enqueue).mockReset();
});

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'oe_1',
    kind: 'email.verification_code',
    payload: { to: 'a@b.com', code: 'ABCD1234', expiresAt: '2026-01-01T00:15:00Z' },
    status: 'PROCESSING',
    attempts: 1,
    scheduledAt: new Date('2026-01-01T00:00:00Z'),
    sentAt: null,
    lastError: null,
    ...overrides,
  };
}

describe('drainOutbox (TEST-02)', () => {
  it('claims a PENDING row via updateMany (PROCESSING + attempts++) before reading it', async () => {
    const row = makeRow();
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    vi.mocked(emailQueueMock.enqueue).mockResolvedValue(undefined as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    await drainOutbox({ prisma: prismaMock, emailQueue: emailQueueMock });

    expect(prismaMock.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'oe_1', status: 'PENDING' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
  });

  it('marks the row SENT with sentAt + lastError=null on successful dispatch', async () => {
    const row = makeRow();
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    vi.mocked(emailQueueMock.enqueue).mockResolvedValue(undefined as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock, emailQueue: emailQueueMock });

    expect(stats.succeeded).toBe(1);
    const finalUpdate = prismaMock.outboxEvent.update.mock.calls[0]?.[0];
    expect(finalUpdate?.where).toEqual({ id: 'oe_1' });
    expect(finalUpdate?.data).toMatchObject({
      status: 'SENT',
      lastError: null,
    });
    expect(finalUpdate?.data?.sentAt).toBeInstanceOf(Date);
  });

  it('reschedules with PENDING + future scheduledAt + lastError when attempts < MAX_ATTEMPTS', async () => {
    // attempts=1 means we are well below the 5-attempt ceiling.
    const row = makeRow({ attempts: 1 });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    // Force the dispatch path to throw — enqueue rejects.
    vi.mocked(emailQueueMock.enqueue).mockRejectedValueOnce(
      new Error('notification provider down') as never,
    );
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock, emailQueue: emailQueueMock });

    expect(stats.failed).toBe(1);
    expect(stats.dead).toBe(0);
    const finalUpdate = prismaMock.outboxEvent.update.mock.calls[0]?.[0];
    expect(finalUpdate?.data).toMatchObject({
      status: 'PENDING',
      lastError: 'notification provider down',
    });
    // Backoff schedule pushes scheduledAt into the future.
    const scheduledAt = finalUpdate?.data?.scheduledAt as Date;
    expect(scheduledAt).toBeInstanceOf(Date);
    expect(scheduledAt.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('marks the row DEAD when attempts >= MAX_ATTEMPTS (5)', async () => {
    // attempts=5 → MAX_ATTEMPTS reached → DEAD path.
    const row = makeRow({ attempts: 5 });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    vi.mocked(emailQueueMock.enqueue).mockRejectedValueOnce(new Error('still down') as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock, emailQueue: emailQueueMock });

    expect(stats.dead).toBe(1);
    expect(stats.failed).toBe(0);
    const finalUpdate = prismaMock.outboxEvent.update.mock.calls[0]?.[0];
    expect(finalUpdate?.data).toMatchObject({
      status: 'DEAD',
      lastError: 'still down',
    });
  });

  it('skips a row when the per-row claim loses the race (claimed.count === 0)', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    // Race lost — another worker won the claim.
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 0 } as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.processed).toBe(1); // candidate count
    expect(stats.succeeded).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.dead).toBe(0);
    expect(prismaMock.outboxEvent.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.outboxEvent.update).not.toHaveBeenCalled();
  });

  it('returns zero counts when there are no PENDING candidates', async () => {
    prismaMock.outboxEvent.findMany.mockResolvedValue([] as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats).toEqual({ processed: 0, succeeded: 0, failed: 0, dead: 0 });
    expect(prismaMock.outboxEvent.updateMany).not.toHaveBeenCalled();
  });

  // Phase 2 — kind-specific coverage for the two event types the Stripe
  // webhook's onPaid handler emits.
  it('dispatches notification.order_paid via createNotification (not prisma.notification.create directly)', async () => {
    const row = makeRow({
      kind: 'notification.order_paid',
      payload: { userId: 'seller-1', orderId: 'order-1', amount: 3600, currency: 'USD' },
    });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' } as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.succeeded).toBe(1);
    const createArgs = prismaMock.notification.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      userId: 'seller-1',
      type: 'ORDER_PAID',
      dedupeKey: 'order-paid:order-1',
    });
  });

  it('dispatches email.order_confirmation via the EmailQueue addressed to the buyer', async () => {
    const row = makeRow({
      kind: 'email.order_confirmation',
      payload: { to: 'buyer@example.com', orderId: 'order-1', amount: 3600, currency: 'USD' },
    });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    vi.mocked(emailQueueMock.enqueue).mockResolvedValue(undefined as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock, emailQueue: emailQueueMock });

    expect(stats.succeeded).toBe(1);
    const enqueueArgs = vi.mocked(emailQueueMock.enqueue).mock.calls[0]?.[0];
    expect(enqueueArgs).toMatchObject({ to: 'buyer@example.com' });
    expect(enqueueArgs?.html).toContain('order-1');
  });

  it('email.order_confirmation throws (retried) when no EmailQueue is configured', async () => {
    const row = makeRow({
      kind: 'email.order_confirmation',
      payload: { to: 'buyer@example.com', orderId: 'order-1', amount: 3600, currency: 'USD' },
      attempts: 1,
    });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock }); // no emailQueue

    expect(stats.failed).toBe(1);
    const finalUpdate = prismaMock.outboxEvent.update.mock.calls[0]?.[0];
    expect(finalUpdate?.data).toMatchObject({ lastError: 'email queue not configured' });
  });

  it('dispatches email.order_refunded via the EmailQueue addressed to the buyer', async () => {
    const row = makeRow({
      kind: 'email.order_refunded',
      payload: { to: 'buyer@example.com', orderId: 'order-1', amount: 3600, currency: 'USD' },
    });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    vi.mocked(emailQueueMock.enqueue).mockResolvedValue(undefined as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock, emailQueue: emailQueueMock });

    expect(stats.succeeded).toBe(1);
    const enqueueArgs = vi.mocked(emailQueueMock.enqueue).mock.calls[0]?.[0];
    expect(enqueueArgs).toMatchObject({ to: 'buyer@example.com' });
    expect(enqueueArgs?.html).toContain('order-1');
  });

  // Phase 4 — low-stock alerts.
  it('dispatches notification.low_stock via createNotification and stamps lowStockNotifiedAt', async () => {
    const row = makeRow({
      kind: 'notification.low_stock',
      payload: {
        userId: 'seller-1',
        productId: 'prod-a',
        variantId: null,
        productName: 'Shea Butter',
        variantLabel: null,
        quantity: 2,
        threshold: 3,
        detectedAt: '2026-08-28T10:00:00.000Z',
      },
    });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' } as never);
    prismaMock.product.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.succeeded).toBe(1);
    const createArgs = prismaMock.notification.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      userId: 'seller-1',
      type: 'LOW_STOCK',
      dedupeKey: 'low-stock:prod-a:base:2026-08-28',
    });
    expect(prismaMock.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'prod-a', lowStockNotifiedAt: null },
      data: { lowStockNotifiedAt: expect.any(Date) },
    });
  });

  it('dispatches notification.out_of_stock for a variant and stamps the variant row', async () => {
    const row = makeRow({
      kind: 'notification.out_of_stock',
      payload: {
        userId: 'seller-1',
        productId: 'prod-a',
        variantId: 'var-1',
        productName: 'Shea Butter',
        variantLabel: 'Size / Large',
        detectedAt: '2026-08-28T10:00:00.000Z',
      },
    });
    prismaMock.outboxEvent.findMany.mockResolvedValue([{ id: 'oe_1' }] as never);
    prismaMock.outboxEvent.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.findUnique.mockResolvedValue(row as never);
    prismaMock.notification.create.mockResolvedValue({ id: 'n1' } as never);
    prismaMock.productVariant.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.outboxEvent.update.mockResolvedValue({} as never);

    const stats = await drainOutbox({ prisma: prismaMock });

    expect(stats.succeeded).toBe(1);
    const createArgs = prismaMock.notification.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      type: 'OUT_OF_STOCK',
      dedupeKey: 'out-of-stock:prod-a:var-1:2026-08-28',
    });
    expect(prismaMock.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 'var-1', lowStockNotifiedAt: null },
      data: { lowStockNotifiedAt: expect.any(Date) },
    });
    expect(prismaMock.product.updateMany).not.toHaveBeenCalled();
  });
});
