import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));
vi.mock('@/lib/server/orders/markPaid', () => ({
  applyOrderPaidEffects: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { applyOrderPaidEffects } from '@/lib/server/orders/markPaid';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const mockApplyOrderPaidEffects = vi.mocked(applyOrderPaidEffects);

const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/orders/order-1/confirm-payment', {
    method: 'POST',
    headers,
  });
}

function ctxWith(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
  prismaMock.$transaction.mockImplementation(async (cb: unknown) =>
    typeof cb === 'function' ? (cb as (tx: typeof prismaMock) => unknown)(prismaMock) : cb,
  );
});

describe('POST /api/orders/[id]/confirm-payment', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost('missing'), ctxWith('order-1'));
    expect(res.status).toBe(403);
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it('propagates 401 from requireAuth', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(401);
  });

  it('404s ORDER_NOT_FOUND when the caller does not own this order', async () => {
    prismaMock.order.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('ORDER_NOT_FOUND');
  });

  it('400s NOT_A_MANUAL_PAYMENT for a stripe_platform order — never lets a seller confirm a real payment manually', async () => {
    prismaMock.order.findFirst.mockResolvedValueOnce({
      id: 'order-1',
      storeId: 'store-1',
      status: 'PENDING',
      provider: 'stripe_platform',
    } as never);

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('NOT_A_MANUAL_PAYMENT');
    expect(mockApplyOrderPaidEffects).not.toHaveBeenCalled();
  });

  it('422s ORDER_NOT_PENDING when the order is already PAID', async () => {
    prismaMock.order.findFirst.mockResolvedValueOnce({
      id: 'order-1',
      storeId: 'store-1',
      status: 'PAID',
      provider: 'cashapp_manual',
    } as never);

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('ORDER_NOT_PENDING');
    expect(mockApplyOrderPaidEffects).not.toHaveBeenCalled();
  });

  it('confirms a cashapp_manual order — calls applyOrderPaidEffects with paymentMethod "cashapp"', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'PENDING',
      provider: 'cashapp_manual',
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    prismaMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...order,
      status: 'PAID',
    } as never);

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.status).toBe('PAID');

    expect(mockApplyOrderPaidEffects).toHaveBeenCalledWith(prismaMock, order, {
      paymentMethod: 'cashapp',
    });
    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('confirms a zelle_manual order — calls applyOrderPaidEffects with paymentMethod "zelle"', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'PENDING',
      provider: 'zelle_manual',
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    prismaMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...order,
      status: 'PAID',
    } as never);

    await POST(makePost(), ctxWith('order-1'));
    expect(mockApplyOrderPaidEffects).toHaveBeenCalledWith(prismaMock, order, {
      paymentMethod: 'zelle',
    });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs', withRequestContext and verifyCsrf", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
    expect(src).toContain('verifyCsrf');
  });
});
