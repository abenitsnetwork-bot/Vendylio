import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';

const webhookLogFindUnique = vi.fn();
const webhookLogCreate = vi.fn();
const webhookLogUpdate = vi.fn();
const deliveryFindFirst = vi.fn();
const deliveryUpdate = vi.fn();
const orderUpdate = vi.fn();
const orderStatusEventCreate = vi.fn();
const storeFindUnique = vi.fn();
const outboxEventCreate = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: {
      findUnique: webhookLogFindUnique,
      create: webhookLogCreate,
      update: webhookLogUpdate,
    },
    delivery: { findFirst: deliveryFindFirst, update: deliveryUpdate },
    order: { update: orderUpdate },
    orderStatusEvent: { create: orderStatusEventCreate },
    store: { findUnique: storeFindUnique },
    outboxEvent: { create: outboxEventCreate },
  }),
);

vi.mock('@/lib/server/prisma', () => ({
  prisma: { $transaction },
}));

const SIGNING_KEY = 'test-uber-direct-signing-key';

function makeReq(body: Record<string, unknown>, key: string = SIGNING_KEY): NextRequest {
  const payload = JSON.stringify(body);
  const sig = createHmac('sha256', key).update(payload).digest('hex');
  return new NextRequest('http://localhost/api/webhooks/uber-direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-uber-signature': sig },
    body: Buffer.from(payload) as unknown as BodyInit,
  });
}

beforeEach(() => {
  vi.stubEnv('UBER_DIRECT_WEBHOOK_SIGNING_KEY', SIGNING_KEY);
  webhookLogFindUnique.mockReset().mockResolvedValue(null);
  webhookLogCreate.mockReset();
  webhookLogUpdate.mockReset();
  deliveryFindFirst.mockReset();
  deliveryUpdate.mockReset();
  orderUpdate.mockReset();
  orderStatusEventCreate.mockReset();
  storeFindUnique.mockReset();
  outboxEventCreate.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/webhooks/uber-direct', () => {
  it('rejects a badly signed body with 401', async () => {
    const req = makeReq({ id: 'evt_1', delivery_id: 'del_1', status: 'delivered' }, 'wrong-key');
    const { POST } = await import('./route');
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('is a no-op for a delivery_id with no matching Delivery row', async () => {
    deliveryFindFirst.mockResolvedValueOnce(null);
    const req = makeReq({ id: 'evt_1', delivery_id: 'del_unknown', status: 'delivered' });
    const { POST } = await import('./route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(deliveryUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent — a Delivery already DELIVERED is left untouched', async () => {
    deliveryFindFirst.mockResolvedValueOnce({
      id: 'del-row-1',
      orderId: 'order-1',
      status: 'DELIVERED',
      order: { id: 'order-1', storeId: 'store-1' },
    });
    const req = makeReq({ id: 'evt_1', delivery_id: 'del_1', status: 'delivered' });
    const { POST } = await import('./route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(deliveryUpdate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('marks the Delivery + Order DELIVERED, writes a SYSTEM status event, and enqueues a seller notification', async () => {
    deliveryFindFirst.mockResolvedValueOnce({
      id: 'del-row-1',
      orderId: 'order-1',
      status: 'REQUESTED',
      order: { id: 'order-1', storeId: 'store-1' },
    });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'owner-1' } });
    const req = makeReq({ id: 'evt_1', delivery_id: 'del_1', status: 'delivered' });
    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'del-row-1' },
      data: { status: 'DELIVERED', deliveredAt: expect.any(Date) },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'DELIVERED' },
    });
    expect(orderStatusEventCreate).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'DELIVERED', actorType: 'SYSTEM' },
    });
    expect(outboxEventCreate).toHaveBeenCalledWith({
      data: {
        kind: 'notification.delivery_completed',
        payload: { userId: 'owner-1', orderId: 'order-1' },
      },
      select: { id: true },
    });
  });

  it('marks the Delivery FAILED and reverts an OUT_FOR_DELIVERY Order back to READY — never straight to CANCELLED', async () => {
    deliveryFindFirst.mockResolvedValueOnce({
      id: 'del-row-1',
      orderId: 'order-1',
      status: 'REQUESTED',
      order: { id: 'order-1', status: 'OUT_FOR_DELIVERY', storeId: 'store-1' },
    });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'owner-1' } });
    const req = makeReq({ id: 'evt_2', delivery_id: 'del_1', status: 'canceled' });
    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'del-row-1' },
      data: { status: 'FAILED' },
    });
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'READY' },
    });
    expect(orderStatusEventCreate).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'READY', actorType: 'SYSTEM' },
    });
    expect(outboxEventCreate).toHaveBeenCalledWith({
      data: {
        kind: 'notification.delivery_failed',
        payload: { userId: 'owner-1', orderId: 'order-1', status: 'canceled' },
      },
      select: { id: true },
    });
  });

  it('marks the Delivery FAILED but leaves the Order alone when it already moved on some other way', async () => {
    deliveryFindFirst.mockResolvedValueOnce({
      id: 'del-row-1',
      orderId: 'order-1',
      status: 'REQUESTED',
      order: { id: 'order-1', status: 'REFUNDED', storeId: 'store-1' },
    });
    storeFindUnique.mockResolvedValueOnce({ organization: { ownerId: 'owner-1' } });
    const req = makeReq({ id: 'evt_2', delivery_id: 'del_1', status: 'canceled' });
    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(deliveryUpdate).toHaveBeenCalledWith({
      where: { id: 'del-row-1' },
      data: { status: 'FAILED' },
    });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(orderStatusEventCreate).not.toHaveBeenCalled();
  });

  it('is idempotent — a Delivery already FAILED is left untouched', async () => {
    deliveryFindFirst.mockResolvedValueOnce({
      id: 'del-row-1',
      orderId: 'order-1',
      status: 'FAILED',
      order: { id: 'order-1', status: 'READY', storeId: 'store-1' },
    });
    const req = makeReq({ id: 'evt_2', delivery_id: 'del_1', status: 'canceled' });
    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(deliveryUpdate).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(outboxEventCreate).not.toHaveBeenCalled();
  });

  it('is a no-op on cancellation for an unknown delivery_id', async () => {
    deliveryFindFirst.mockResolvedValueOnce(null);
    const req = makeReq({ id: 'evt_3', delivery_id: 'del_unknown', status: 'canceled' });
    const { POST } = await import('./route');
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(outboxEventCreate).not.toHaveBeenCalled();
  });

  it('exports runtime=nodejs and dynamic=force-dynamic', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
