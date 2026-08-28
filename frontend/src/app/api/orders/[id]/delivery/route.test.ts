import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/orders/ownership', () => ({
  findOwnedOrder: vi.fn(),
}));
vi.mock('@/lib/server/delivery', () => ({
  getDeliveryProviderFor: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { getDeliveryProviderFor } from '@/lib/server/delivery';
import { POST, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindOwnedOrder = vi.mocked(findOwnedOrder);
const mockGetDeliveryProviderFor = vi.mocked(getDeliveryProviderFor);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'order-1' }) };
const STORE = {
  id: 'store-1',
  name: 'Amara Shop',
  phone: '+15559990000',
  deliveryProvider: 'self_manual',
  pickupAddress: null,
};
const READY_ORDER = {
  id: 'order-1',
  storeId: 'store-1',
  status: 'READY',
  amount: 4500,
  fulfillmentMethod: 'DELIVERY',
  customerName: 'Amara',
  customerPhone: '+15551234567',
  deliveryAddress: null,
  lineItems: [{ productId: 'prod-1', name: 'Widget', priceCents: 4500, quantity: 1 }],
};

function makeReq(method: 'POST' | 'PATCH', csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/orders/order-1/delivery', { method, headers });
}

const mockRequestDelivery = vi.fn(async () => ({
  providerDeliveryId: null,
  status: 'REQUESTED' as const,
}));
const mockMarkDelivered = vi.fn(async () => ({ status: 'DELIVERED' as const }));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockFindOwnedOrder.mockResolvedValue({ store: STORE, order: READY_ORDER } as never);
  mockGetDeliveryProviderFor.mockReturnValue({
    name: 'self_manual',
    requestDelivery: mockRequestDelivery,
    markDelivered: mockMarkDelivered,
  });
  prismaMock.$transaction.mockImplementation(async (fn: unknown) =>
    (fn as (tx: typeof prismaMock) => unknown)(prismaMock),
  );
});

describe('POST /api/orders/[id]/delivery', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makeReq('POST', 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(401);
  });

  it("404s ORDER_NOT_FOUND when the order isn't the caller's", async () => {
    mockFindOwnedOrder.mockResolvedValue({ store: null, order: null });
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('ORDER_NOT_FOUND');
  });

  it('422s FULFILLMENT_METHOD_MISMATCH when the order is a pickup (no courier)', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: { ...READY_ORDER, fulfillmentMethod: 'PICKUP' },
    } as never);
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('FULFILLMENT_METHOD_MISMATCH');
    expect(mockRequestDelivery).not.toHaveBeenCalled();
  });

  it('422s when the order is not READY', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: { ...READY_ORDER, status: 'PREPARING' },
    } as never);
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INVALID_STATUS_TRANSITION');
  });

  it('409s DELIVERY_ALREADY_REQUESTED when a Delivery row already exists', async () => {
    prismaMock.delivery.findUnique.mockResolvedValue({ id: 'del-1' } as never);
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('DELIVERY_ALREADY_REQUESTED');
  });

  it('503s DELIVERY_PROVIDER_UNCONFIGURED when the provider throws (e.g. Uber Direct stub)', async () => {
    prismaMock.delivery.findUnique.mockResolvedValue(null);
    mockGetDeliveryProviderFor.mockReturnValue({
      name: 'uber_direct',
      requestDelivery: vi.fn(async () => {
        throw new Error('Uber Direct is not configured');
      }),
      markDelivered: vi.fn(),
    });
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('DELIVERY_PROVIDER_UNCONFIGURED');
  });

  it('creates a Delivery row, moves the Order to OUT_FOR_DELIVERY, and logs the status event', async () => {
    prismaMock.delivery.findUnique.mockResolvedValue(null);
    prismaMock.delivery.create.mockResolvedValue({
      id: 'del-1',
      orderId: 'order-1',
      provider: 'self_manual',
      status: 'REQUESTED',
    } as never);
    prismaMock.order.update.mockResolvedValue({
      ...READY_ORDER,
      status: 'OUT_FOR_DELIVERY',
    } as never);

    const res = await POST(makeReq('POST'), ctx);

    expect(res.status).toBe(201);
    expect(mockRequestDelivery).toHaveBeenCalledWith({
      orderId: 'order-1',
      storeId: 'store-1',
      customerName: 'Amara',
      customerPhone: '+15551234567',
      deliveryAddress: null,
      pickupAddress: null,
      storeName: 'Amara Shop',
      storePhone: '+15559990000',
      amountCents: 4500,
      manifestItems: [{ name: 'Widget', quantity: 1 }],
    });
    expect(prismaMock.delivery.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        provider: 'self_manual',
        providerDeliveryId: null,
        status: 'REQUESTED',
      },
    });
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'OUT_FOR_DELIVERY' },
    });
    expect(prismaMock.orderStatusEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'OUT_FOR_DELIVERY', actorType: 'SELLER' },
    });
  });

  it('sends a weight-sold line item as one manifest package with the weight folded into the name (Uber rejects fractional package counts)', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: {
        ...READY_ORDER,
        lineItems: [
          {
            productId: 'prod-1',
            name: 'poisson maquereau',
            priceCents: 900,
            quantity: 5.3,
            unit: 'LB',
          },
        ],
      },
    } as never);
    prismaMock.delivery.findUnique.mockResolvedValue(null);
    prismaMock.delivery.create.mockResolvedValue({
      id: 'del-1',
      orderId: 'order-1',
      provider: 'self_manual',
      status: 'REQUESTED',
    } as never);
    prismaMock.order.update.mockResolvedValue({
      ...READY_ORDER,
      status: 'OUT_FOR_DELIVERY',
    } as never);

    await POST(makeReq('POST'), ctx);

    expect(mockRequestDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestItems: [{ name: 'poisson maquereau (5.30 lb)', quantity: 1 }],
      }),
    );
  });

  it('rounds and floors a fractional UNIT-item quantity at 1 (defensive minimum)', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: {
        ...READY_ORDER,
        lineItems: [{ productId: 'prod-1', name: 'Widget', priceCents: 4500, quantity: 0.4 }],
      },
    } as never);
    prismaMock.delivery.findUnique.mockResolvedValue(null);
    prismaMock.delivery.create.mockResolvedValue({
      id: 'del-1',
      orderId: 'order-1',
      provider: 'self_manual',
      status: 'REQUESTED',
    } as never);
    prismaMock.order.update.mockResolvedValue({
      ...READY_ORDER,
      status: 'OUT_FOR_DELIVERY',
    } as never);

    await POST(makeReq('POST'), ctx);

    expect(mockRequestDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestItems: [{ name: 'Widget', quantity: 1 }],
      }),
    );
  });
});

describe('PATCH /api/orders/[id]/delivery', () => {
  const OUT_FOR_DELIVERY_ORDER = { ...READY_ORDER, status: 'OUT_FOR_DELIVERY' };
  const REQUESTED_DELIVERY = {
    id: 'del-1',
    orderId: 'order-1',
    provider: 'self_manual',
    providerDeliveryId: null,
    status: 'REQUESTED',
  };

  beforeEach(() => {
    mockFindOwnedOrder.mockResolvedValue({ store: STORE, order: OUT_FOR_DELIVERY_ORDER } as never);
  });

  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq('PATCH', 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it("404s ORDER_NOT_FOUND when the order isn't the caller's", async () => {
    mockFindOwnedOrder.mockResolvedValue({ store: null, order: null });
    const res = await PATCH(makeReq('PATCH'), ctx);
    expect(res.status).toBe(404);
  });

  it('404s DELIVERY_NOT_FOUND when no delivery was ever requested', async () => {
    prismaMock.delivery.findUnique.mockResolvedValue(null);
    const res = await PATCH(makeReq('PATCH'), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('DELIVERY_NOT_FOUND');
  });

  it('422s when the order is not OUT_FOR_DELIVERY', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: { ...READY_ORDER, status: 'READY' },
    } as never);
    prismaMock.delivery.findUnique.mockResolvedValue(REQUESTED_DELIVERY as never);
    const res = await PATCH(makeReq('PATCH'), ctx);
    expect(res.status).toBe(422);
  });

  it('422s when the delivery is already DELIVERED', async () => {
    prismaMock.delivery.findUnique.mockResolvedValue({
      ...REQUESTED_DELIVERY,
      status: 'DELIVERED',
    } as never);
    const res = await PATCH(makeReq('PATCH'), ctx);
    expect(res.status).toBe(422);
  });

  it('marks the Delivery + Order DELIVERED and logs the status event', async () => {
    prismaMock.delivery.findUnique.mockResolvedValue(REQUESTED_DELIVERY as never);
    prismaMock.delivery.update.mockResolvedValue({
      ...REQUESTED_DELIVERY,
      status: 'DELIVERED',
      deliveredAt: new Date(),
    } as never);
    prismaMock.order.update.mockResolvedValue({
      ...OUT_FOR_DELIVERY_ORDER,
      status: 'DELIVERED',
    } as never);

    const res = await PATCH(makeReq('PATCH'), ctx);

    expect(res.status).toBe(200);
    const updateArgs = prismaMock.delivery.update.mock.calls[0]?.[0];
    expect(updateArgs?.where).toEqual({ id: 'del-1' });
    expect(updateArgs?.data).toMatchObject({ status: 'DELIVERED' });
    expect(updateArgs?.data?.deliveredAt).toBeInstanceOf(Date);
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: 'DELIVERED' },
    });
    expect(prismaMock.orderStatusEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: 'DELIVERED', actorType: 'SELLER' },
    });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
