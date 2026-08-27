import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'order-1' }) };

function makeReq(
  method: 'GET' | 'PATCH',
  body?: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/orders/order-1', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const OWNED_ORDER = { id: 'order-1', storeId: 'store-1', status: 'PAID' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
});

describe('GET /api/orders/[id]', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeReq('GET'), ctx);
    expect(res.status).toBe(401);
  });

  it("404s ORDER_NOT_FOUND when the order isn't the caller's", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);
    const res = await GET(makeReq('GET'), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('ORDER_NOT_FOUND');
  });

  it('404s ORDER_NOT_FOUND (not 403) when the seller has no store at all', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeReq('GET'), ctx);
    expect(res.status).toBe(404);
  });

  it('returns the order + its status history + delivery (Phase 5) when owned', async () => {
    prismaMock.order.findFirst.mockResolvedValue(OWNED_ORDER as never);
    prismaMock.orderStatusEvent.findMany.mockResolvedValue([
      { id: 'ev1', orderId: 'order-1', status: 'PAID', actorType: 'SYSTEM', createdAt: new Date() },
    ] as never);
    prismaMock.delivery.findUnique.mockResolvedValue({
      id: 'del-1',
      orderId: 'order-1',
      provider: 'self_manual',
      status: 'REQUESTED',
    } as never);

    const res = await GET(makeReq('GET'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.id).toBe('order-1');
    expect(body.statusEvents).toHaveLength(1);
    expect(body.delivery.id).toBe('del-1');
  });

  it('returns delivery: null when no delivery was requested', async () => {
    prismaMock.order.findFirst.mockResolvedValue(OWNED_ORDER as never);
    prismaMock.orderStatusEvent.findMany.mockResolvedValue([]);
    prismaMock.delivery.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq('GET'), ctx);
    const body = await res.json();
    expect(body.delivery).toBeNull();
  });
});

describe('PATCH /api/orders/[id] — status transitions', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq('PATCH', { status: 'PREPARING' }, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it("404s ORDER_NOT_FOUND when the order isn't the caller's", async () => {
    prismaMock.order.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq('PATCH', { status: 'PREPARING' }), ctx);
    expect(res.status).toBe(404);
  });

  it('400s VALIDATION_FAILED on an unknown status value', async () => {
    prismaMock.order.findFirst.mockResolvedValue(OWNED_ORDER as never);
    const res = await PATCH(makeReq('PATCH', { status: 'NOT_A_STATUS' }), ctx);
    expect(res.status).toBe(400);
  });

  it.each([
    ['PAID', 'PREPARING'],
    ['PREPARING', 'READY'],
    ['READY', 'OUT_FOR_DELIVERY'],
    ['OUT_FOR_DELIVERY', 'DELIVERED'],
    ['PAID', 'CANCELLED'],
    ['PREPARING', 'CANCELLED'],
    ['READY', 'CANCELLED'],
    ['OUT_FOR_DELIVERY', 'CANCELLED'],
  ])('allows %s -> %s', async (from, to) => {
    prismaMock.order.findFirst.mockResolvedValue({ ...OWNED_ORDER, status: from } as never);
    prismaMock.$transaction.mockImplementation(async (fn: unknown) =>
      (fn as (tx: typeof prismaMock) => unknown)(prismaMock),
    );
    prismaMock.order.update.mockResolvedValue({ ...OWNED_ORDER, status: to } as never);

    const res = await PATCH(makeReq('PATCH', { status: to }), ctx);

    expect(res.status).toBe(200);
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { status: to },
    });
    expect(prismaMock.orderStatusEvent.create).toHaveBeenCalledWith({
      data: { orderId: 'order-1', status: to, actorType: 'SELLER' },
    });
  });

  it.each([
    ['PAID', 'READY'], // skips PREPARING
    ['PAID', 'DELIVERED'], // skips everything
    ['DELIVERED', 'CANCELLED'], // terminal — no transitions out
    ['CANCELLED', 'PREPARING'], // terminal — no transitions out
    ['PENDING', 'PREPARING'], // not yet paid — not part of the seller lifecycle
  ])('422s INVALID_STATUS_TRANSITION for %s -> %s', async (from, to) => {
    prismaMock.order.findFirst.mockResolvedValue({ ...OWNED_ORDER, status: from } as never);

    const res = await PATCH(makeReq('PATCH', { status: to }), ctx);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INVALID_STATUS_TRANSITION');
    expect(prismaMock.order.update).not.toHaveBeenCalled();
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
