import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from './route';

const ctx = { params: Promise.resolve({ id: 'order-1' }) };
const DELIVERED_ORDER = { id: 'order-1', storeId: 'store-1', status: 'DELIVERED' };

function makeReq(body?: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'any-nonempty-value';
  return new NextRequest('http://test/api/orders/order-1/review', {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.order.findUnique.mockResolvedValue(DELIVERED_ORDER as never);
  prismaMock.review.findUnique.mockResolvedValue(null);
});

describe('POST /api/orders/[id]/review', () => {
  it('403s when CSRF header is missing (guest checkout convention — any non-empty header is fine)', async () => {
    const res = await POST(makeReq({ rating: 5 }, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it("404s ORDER_NOT_FOUND when the order doesn't exist", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ rating: 5 }), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('ORDER_NOT_FOUND');
  });

  it('422s REVIEW_NOT_ALLOWED when the order is not DELIVERED', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      ...DELIVERED_ORDER,
      status: 'OUT_FOR_DELIVERY',
    } as never);
    const res = await POST(makeReq({ rating: 5 }), ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('REVIEW_NOT_ALLOWED');
  });

  it('409s REVIEW_ALREADY_EXISTS when this order was already reviewed', async () => {
    prismaMock.review.findUnique.mockResolvedValue({ id: 'rev-1' } as never);
    const res = await POST(makeReq({ rating: 5 }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('REVIEW_ALREADY_EXISTS');
  });

  it('400s on an out-of-range rating', async () => {
    const res = await POST(makeReq({ rating: 6 }), ctx);
    expect(res.status).toBe(400);
  });

  it('400s on a missing rating', async () => {
    const res = await POST(makeReq({ text: 'nice' }), ctx);
    expect(res.status).toBe(400);
  });

  it('creates the review scoped to the order and its storeId, and returns 201', async () => {
    prismaMock.review.create.mockResolvedValue({
      id: 'rev-1',
      orderId: 'order-1',
      storeId: 'store-1',
      rating: 5,
      text: 'Excellent',
      visible: true,
    } as never);

    const res = await POST(makeReq({ rating: 5, text: 'Excellent' }), ctx);
    expect(res.status).toBe(201);
    const createArg = prismaMock.review.create.mock.calls[0]?.[0];
    expect(createArg?.data).toEqual({
      orderId: 'order-1',
      storeId: 'store-1',
      rating: 5,
      text: 'Excellent',
    });
  });

  it('omits text from the create payload when not provided', async () => {
    prismaMock.review.create.mockResolvedValue({ id: 'rev-1' } as never);
    await POST(makeReq({ rating: 4 }), ctx);
    const createArg = prismaMock.review.create.mock.calls[0]?.[0];
    expect(createArg?.data).toEqual({ orderId: 'order-1', storeId: 'store-1', rating: 4 });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
