import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));
vi.mock('@/lib/server/orders/refund', () => ({
  applyOrderRefundedEffects: vi.fn(),
}));
vi.mock('@/lib/server/payments/provider-singleton', () => ({
  getProvider: vi.fn(),
  PaymentProviderUnconfiguredError: class PaymentProviderUnconfiguredError extends Error {},
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { applyOrderRefundedEffects } from '@/lib/server/orders/refund';
import {
  getProvider,
  PaymentProviderUnconfiguredError,
} from '@/lib/server/payments/provider-singleton';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const mockApplyOrderRefundedEffects = vi.mocked(applyOrderRefundedEffects);
const mockGetProvider = vi.mocked(getProvider);

const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/orders/order-1/refund', { method: 'POST', headers });
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

describe('POST /api/orders/[id]/refund', () => {
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

  it.each(['PENDING', 'CANCELLED', 'REFUNDED', 'EXPIRED', 'FAILED'])(
    '422s ORDER_NOT_REFUNDABLE for status %s',
    async (status) => {
      prismaMock.order.findFirst.mockResolvedValueOnce({
        id: 'order-1',
        storeId: 'store-1',
        status,
        provider: 'stripe_platform',
      } as never);
      const res = await POST(makePost(), ctxWith('order-1'));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('ORDER_NOT_REFUNDABLE');
      expect(mockApplyOrderRefundedEffects).not.toHaveBeenCalled();
    },
  );

  it('calls provider.refund() for a stripe_platform order and does not reverse a transfer', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'PAID',
      provider: 'stripe_platform',
      providerChargeId: 'cs_test_1',
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    prismaMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...order,
      status: 'REFUNDED',
    } as never);
    const refundFn = vi.fn(async () => ({
      providerRefundId: 're_1',
      status: 'COMPLETED' as const,
    }));
    mockGetProvider.mockReturnValue({ name: 'stripe', charge: vi.fn(), refund: refundFn } as never);

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(200);
    expect(refundFn).toHaveBeenCalledWith({
      providerChargeId: 'cs_test_1',
      reverseTransfer: false,
    });
    expect(mockApplyOrderRefundedEffects).toHaveBeenCalledWith(prismaMock, order);
  });

  it('reverses the Connect transfer for a stripe_connect order', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'DELIVERED',
      provider: 'stripe_connect',
      providerChargeId: 'cs_test_2',
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    prismaMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...order,
      status: 'REFUNDED',
    } as never);
    const refundFn = vi.fn(async () => ({
      providerRefundId: 're_2',
      status: 'COMPLETED' as const,
    }));
    mockGetProvider.mockReturnValue({ name: 'stripe', charge: vi.fn(), refund: refundFn } as never);

    await POST(makePost(), ctxWith('order-1'));
    expect(refundFn).toHaveBeenCalledWith({
      providerChargeId: 'cs_test_2',
      reverseTransfer: true,
    });
  });

  it('502s REFUND_FAILED when the Stripe refund call throws, without touching the DB', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'PAID',
      provider: 'stripe_platform',
      providerChargeId: 'cs_test_1',
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    const refundFn = vi.fn(async () => {
      throw new Error('card issuer declined the refund');
    });
    mockGetProvider.mockReturnValue({ name: 'stripe', charge: vi.fn(), refund: refundFn } as never);

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('REFUND_FAILED');
    expect(mockApplyOrderRefundedEffects).not.toHaveBeenCalled();
  });

  it('503s PAYMENT_PROVIDER_UNCONFIGURED when Stripe env vars are missing', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'PAID',
      provider: 'stripe_platform',
      providerChargeId: 'cs_test_1',
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    mockGetProvider.mockImplementation(() => {
      throw new PaymentProviderUnconfiguredError();
    });

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNCONFIGURED');
  });

  it('skips the Stripe API entirely for a cashapp_manual order — trusts the seller', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'PAID',
      provider: 'cashapp_manual',
      providerChargeId: null,
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    prismaMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...order,
      status: 'REFUNDED',
    } as never);

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(200);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockApplyOrderRefundedEffects).toHaveBeenCalledWith(prismaMock, order);
  });

  it('skips the Stripe API entirely for a zelle_manual order — trusts the seller', async () => {
    const order = {
      id: 'order-1',
      storeId: 'store-1',
      status: 'DELIVERED',
      provider: 'zelle_manual',
      providerChargeId: null,
    };
    prismaMock.order.findFirst.mockResolvedValueOnce(order as never);
    prismaMock.order.findUniqueOrThrow.mockResolvedValueOnce({
      ...order,
      status: 'REFUNDED',
    } as never);

    const res = await POST(makePost(), ctxWith('order-1'));
    expect(res.status).toBe(200);
    expect(mockGetProvider).not.toHaveBeenCalled();
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
