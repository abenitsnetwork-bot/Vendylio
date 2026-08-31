import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/orders/ownership', () => ({ findOwnedOrder: vi.fn() }));
vi.mock('@/lib/server/fulfillment/service', () => ({
  createFulfillment: vi.fn(),
  updateFulfillment: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { createFulfillment, updateFulfillment } from '@/lib/server/fulfillment/service';
import { POST, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindOwnedOrder = vi.mocked(findOwnedOrder);
const mockCreateFulfillment = vi.mocked(createFulfillment);
const mockUpdateFulfillment = vi.mocked(updateFulfillment);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'order-1' }) };
const STORE = { id: 'store-1', name: 'Amara Shop' };
const READY_ORDER = {
  id: 'order-1',
  storeId: 'store-1',
  status: 'READY',
  fulfillmentMethod: 'DELIVERY',
};

function makeReq(method: 'POST' | 'PATCH', csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/orders/order-1/delivery', { method, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockFindOwnedOrder.mockResolvedValue({ store: STORE, order: READY_ORDER } as never);
  prismaMock.delivery.findUnique.mockResolvedValue({
    id: 'del-1',
    state: 'PENDING',
    providerType: 'MERCHANT',
  } as never);
  mockCreateFulfillment.mockResolvedValue({ state: 'OUT_FOR_DELIVERY', dispatched: false });
  mockUpdateFulfillment.mockResolvedValue({ changed: true, deduped: false, state: 'DELIVERED' });
});

describe('POST /api/orders/[id]/delivery', () => {
  it('403s when CSRF header is missing', async () => {
    expect((await POST(makeReq('POST', 'missing'), ctx)).status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await POST(makeReq('POST'), ctx)).status).toBe(401);
  });

  it("404s ORDER_NOT_FOUND when the order isn't the caller's", async () => {
    mockFindOwnedOrder.mockResolvedValue({ store: null, order: null });
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ORDER_NOT_FOUND');
  });

  it('422s FULFILLMENT_METHOD_MISMATCH for a pickup order', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: { ...READY_ORDER, fulfillmentMethod: 'PICKUP' },
    } as never);
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('FULFILLMENT_METHOD_MISMATCH');
    expect(mockCreateFulfillment).not.toHaveBeenCalled();
  });

  it('422s when the order is not READY', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: { ...READY_ORDER, status: 'PREPARING' },
    } as never);
    expect((await POST(makeReq('POST'), ctx)).status).toBe(422);
  });

  it('404s DELIVERY_NOT_FOUND when the order has no fulfillment record', async () => {
    prismaMock.delivery.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('DELIVERY_NOT_FOUND');
  });

  it('409s DELIVERY_ALREADY_REQUESTED when the delivery is already in flight', async () => {
    prismaMock.delivery.findUnique.mockResolvedValueOnce({
      id: 'del-1',
      state: 'OUT_FOR_DELIVERY',
      providerType: 'UBER_DIRECT',
    } as never);
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(409);
    expect(mockCreateFulfillment).not.toHaveBeenCalled();
  });

  it('retries when the existing delivery is FAILED', async () => {
    prismaMock.delivery.findUnique.mockResolvedValueOnce({
      id: 'del-1',
      state: 'FAILED',
      providerType: 'UBER_DIRECT',
    } as never);
    mockCreateFulfillment.mockResolvedValueOnce({ state: 'REQUESTED', dispatched: true });
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(201);
    expect(mockCreateFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'del-1',
      expect.objectContaining({ force: true }),
    );
  });

  it('503s DELIVERY_CREATION_FAILED when the courier request fails', async () => {
    prismaMock.delivery.findUnique.mockResolvedValueOnce({
      id: 'del-1',
      state: 'PENDING',
      providerType: 'UBER_DIRECT',
    } as never);
    mockCreateFulfillment.mockResolvedValueOnce({
      state: 'FAILED',
      dispatched: false,
      error: 'Uber Direct is not configured',
    });
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('DELIVERY_CREATION_FAILED');
  });

  it('dispatches via the fulfillment service and returns 201', async () => {
    const res = await POST(makeReq('POST'), ctx);
    expect(res.status).toBe(201);
    expect(mockCreateFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'del-1',
      expect.objectContaining({ actor: 'MERCHANT', force: true }),
    );
  });
});

describe('PATCH /api/orders/[id]/delivery', () => {
  beforeEach(() => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: { ...READY_ORDER, status: 'OUT_FOR_DELIVERY' },
    } as never);
    prismaMock.delivery.findUnique.mockResolvedValue({
      id: 'del-1',
      state: 'OUT_FOR_DELIVERY',
      providerType: 'MERCHANT',
    } as never);
  });

  it('403s when CSRF header is missing', async () => {
    expect((await PATCH(makeReq('PATCH', 'missing'), ctx)).status).toBe(403);
  });

  it('404s DELIVERY_NOT_FOUND when no delivery exists', async () => {
    prismaMock.delivery.findUnique.mockResolvedValueOnce(null);
    expect((await PATCH(makeReq('PATCH'), ctx)).status).toBe(404);
  });

  it('422s for a courier delivery (completes from its webhook, not a click)', async () => {
    prismaMock.delivery.findUnique.mockResolvedValueOnce({
      id: 'del-1',
      state: 'OUT_FOR_DELIVERY',
      providerType: 'DOORDASH',
    } as never);
    const res = await PATCH(makeReq('PATCH'), ctx);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('COURIER_COMPLETES_AUTOMATICALLY');
    expect(mockUpdateFulfillment).not.toHaveBeenCalled();
  });

  it('422s when the order is not OUT_FOR_DELIVERY', async () => {
    mockFindOwnedOrder.mockResolvedValue({
      store: STORE,
      order: { ...READY_ORDER, status: 'READY' },
    } as never);
    expect((await PATCH(makeReq('PATCH'), ctx)).status).toBe(422);
  });

  it('marks a merchant delivery DELIVERED via the service', async () => {
    const res = await PATCH(makeReq('PATCH'), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdateFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'del-1',
      'DELIVERED',
      'MERCHANT',
    );
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
