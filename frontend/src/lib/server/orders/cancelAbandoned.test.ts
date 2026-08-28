import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cancelAbandonedOrder } from './cancelAbandoned';

describe('cancelAbandonedOrder', () => {
  let updateMany: ReturnType<typeof vi.fn>;
  let orderStatusEventCreate: ReturnType<typeof vi.fn>;
  let $transaction: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(() => {
    updateMany = vi.fn();
    orderStatusEventCreate = vi.fn();
    $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ order: { updateMany }, orderStatusEvent: { create: orderStatusEventCreate } }),
    );
    prisma = { $transaction };
  });

  it('cancels a still-PENDING order and writes a SYSTEM status event', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 });
    const result = await cancelAbandonedOrder(prisma, 'order-1');

    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    expect(orderStatusEventCreate).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'CANCELLED', actorType: 'SYSTEM' },
    });
  });

  it('is a no-op when the order already moved past PENDING (race with a webhook)', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await cancelAbandonedOrder(prisma, 'order-1');

    expect(result).toBe(false);
    expect(orderStatusEventCreate).not.toHaveBeenCalled();
  });
});
