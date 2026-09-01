import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createFulfillment, handleProviderEvent, getDelivery, isConfigured } = vi.hoisted(() => ({
  createFulfillment: vi.fn(),
  handleProviderEvent: vi.fn(),
  getDelivery: vi.fn(),
  isConfigured: vi.fn(() => true),
}));
vi.mock('./service', () => ({ createFulfillment, handleProviderEvent }));
vi.mock('./registry', () => ({
  getDeliveryProvider: vi.fn(() => ({ getDelivery, isConfigured })),
}));

import { runFulfillmentTick } from './dispatch';

beforeEach(() => {
  vi.clearAllMocks();
  isConfigured.mockReturnValue(true);
  prismaMock.$transaction.mockImplementation((cb: unknown) =>
    typeof cb === 'function'
      ? ((cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>)
      : Promise.resolve(cb),
  );
  prismaMock.$executeRawUnsafe.mockResolvedValue(0 as never);
  prismaMock.delivery.findMany.mockResolvedValue([] as never);
  prismaMock.delivery.count.mockResolvedValue(0 as never);
  prismaMock.quote.deleteMany.mockResolvedValue({ count: 0 } as never);
});

describe('runFulfillmentTick', () => {
  it('dispatches each PENDING courier delivery and counts the outcomes', async () => {
    prismaMock.delivery.findMany
      .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }] as never) // dispatch batch
      .mockResolvedValueOnce([] as never); // poll batch
    createFulfillment
      .mockResolvedValueOnce({ state: 'REQUESTED', dispatched: true })
      .mockResolvedValueOnce({ state: 'PENDING', dispatched: false, error: 'boom' });

    const res = await runFulfillmentTick(prismaMock as never);
    expect(createFulfillment).toHaveBeenCalledTimes(2);
    expect(res.dispatched).toBe(1);
    expect(res.dispatchFailed).toBe(1);
  });

  it('polls in-flight deliveries and folds a real snapshot through the service', async () => {
    prismaMock.delivery.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { id: 'd9', providerType: 'UBER_DIRECT', externalDeliveryId: 'vend_d9' },
      ] as never);
    getDelivery.mockResolvedValue({
      providerDeliveryId: 'x',
      rawStatus: 'dropoff',
      state: 'OUT_FOR_DELIVERY',
    });
    handleProviderEvent.mockResolvedValue({
      changed: true,
      deduped: false,
      state: 'OUT_FOR_DELIVERY',
    });

    const res = await runFulfillmentTick(prismaMock as never);
    expect(getDelivery).toHaveBeenCalledWith('vend_d9');
    expect(handleProviderEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        deliveryId: 'd9',
        source: 'CRON',
        providerEventId: 'poll:dropoff',
      }),
    );
    expect(res.polled).toBe(1);
    expect(res.pollAdvanced).toBe(1);
  });

  it('skips the poll when the provider returns UNKNOWN', async () => {
    prismaMock.delivery.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        { id: 'd9', providerType: 'DOORDASH', externalDeliveryId: 'vend_d9' },
      ] as never);
    getDelivery.mockResolvedValue({ providerDeliveryId: null, rawStatus: '?', state: 'UNKNOWN' });

    const res = await runFulfillmentTick(prismaMock as never);
    expect(handleProviderEvent).not.toHaveBeenCalled();
    expect(res.pollAdvanced).toBe(0);
  });

  it('purges stale quotes', async () => {
    prismaMock.quote.deleteMany.mockResolvedValue({ count: 12 } as never);
    const res = await runFulfillmentTick(prismaMock as never);
    expect(prismaMock.quote.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { lt: expect.any(Date) } } }),
    );
    expect(res.quotesPurged).toBe(12);
  });

  it('counts stale deliveries in each bucket without cancelling anything (Prompt #13 Y2)', async () => {
    // dispatch batch, poll batch, then 3 stale count() calls
    prismaMock.delivery.count
      .mockResolvedValueOnce(2 as never) // staleDispatch
      .mockResolvedValueOnce(1 as never) // staleUnassigned
      .mockResolvedValueOnce(3 as never); // staleInTransit

    const res = await runFulfillmentTick(prismaMock as never);

    expect(res.staleDispatch).toBe(2);
    expect(res.staleUnassigned).toBe(1);
    expect(res.staleInTransit).toBe(3);
    // detection only — never writes / cancels
    expect(prismaMock.delivery.update).not.toHaveBeenCalled();
    expect(prismaMock.delivery.updateMany).not.toHaveBeenCalled();

    const staleWhere = prismaMock.delivery.count.mock.calls.map(
      (c) => (c[0] as { where: unknown }).where,
    );
    expect(staleWhere[0]).toMatchObject({ state: 'PENDING', order: { status: 'READY' } });
    expect(staleWhere[1]).toMatchObject({ state: 'REQUESTED' });
    expect(staleWhere[2]).toMatchObject({ state: { in: ['PICKED_UP', 'OUT_FOR_DELIVERY'] } });
  });

  it('stays quiet when nothing is stale', async () => {
    const res = await runFulfillmentTick(prismaMock as never);
    expect(res.staleDispatch).toBe(0);
    expect(res.staleUnassigned).toBe(0);
    expect(res.staleInTransit).toBe(0);
  });
});
