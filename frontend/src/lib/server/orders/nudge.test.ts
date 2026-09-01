import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nudgeUnfulfilledOrders } from './nudge';

describe('nudgeUnfulfilledOrders (ORD-01)', () => {
  let orderFindMany: ReturnType<typeof vi.fn>;
  let notificationFindMany: ReturnType<typeof vi.fn>;
  let outboxCreate: ReturnType<typeof vi.fn>;
  let $transaction: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const owned = (id: string, hoursAgo: number) => ({
    id,
    paidAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    store: { organization: { ownerId: 'seller-1' } },
  });

  beforeEach(() => {
    orderFindMany = vi.fn();
    notificationFindMany = vi.fn().mockResolvedValue([]);
    outboxCreate = vi.fn().mockResolvedValue({ id: 'oe' });
    $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ outboxEvent: { create: outboxCreate } }),
    );
    prisma = {
      order: { findMany: orderFindMany },
      notification: { findMany: notificationFindMany },
      $transaction,
    };
  });

  it('returns zeros and does nothing when no stale orders', async () => {
    orderFindMany.mockResolvedValueOnce([]);
    const r = await nudgeUnfulfilledOrders({ prisma });
    expect(r).toEqual({ scanned: 0, nudged: 0 });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('enqueues an in-app + email nudge pair per stale order', async () => {
    orderFindMany.mockResolvedValueOnce([owned('o1', 10), owned('o2', 20)]);
    const r = await nudgeUnfulfilledOrders({ prisma });
    expect(r).toEqual({ scanned: 2, nudged: 2 });
    const kinds = outboxCreate.mock.calls.map((c) => c[0].data.kind);
    expect(kinds).toEqual([
      'notification.order_unfulfilled',
      'email.order_unfulfilled',
      'notification.order_unfulfilled',
      'email.order_unfulfilled',
    ]);
  });

  it('skips orders that already carry the nudge notification', async () => {
    orderFindMany.mockResolvedValueOnce([owned('o1', 10), owned('o2', 20)]);
    notificationFindMany.mockResolvedValueOnce([{ dedupeKey: 'order-unfulfilled:o1' }]);
    const r = await nudgeUnfulfilledOrders({ prisma });
    expect(r).toEqual({ scanned: 2, nudged: 1 });
    const orderIds = outboxCreate.mock.calls.map((c) => c[0].data.payload.orderId);
    expect(orderIds).toEqual(['o2', 'o2']);
  });

  it('only scans PAID / PREPARING orders inside the age window', async () => {
    orderFindMany.mockResolvedValueOnce([]);
    await nudgeUnfulfilledOrders({ prisma });
    const where = orderFindMany.mock.calls[0]![0].where;
    expect(where.status).toEqual({ in: ['PAID', 'PREPARING'] });
    expect(where.paidAt.lte).toBeInstanceOf(Date);
    expect(where.paidAt.gte).toBeInstanceOf(Date);
  });
});
