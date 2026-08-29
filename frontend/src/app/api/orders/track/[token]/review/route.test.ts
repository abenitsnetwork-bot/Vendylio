import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from './route';

const TOKEN = 'tok_abcdefabcdefabcdef1234567890';
const ctx = { params: Promise.resolve({ token: TOKEN }) };
const DELIVERED_ORDER = { id: 'order-1', storeId: 'store-1', status: 'DELIVERED' };

function makeReq(body?: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'any-nonempty-value';
  return new NextRequest(`http://test/api/orders/track/${TOKEN}/review`, {
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

describe('POST /api/orders/track/[token]/review', () => {
  it('looks the order up by trackingToken, never by id', async () => {
    prismaMock.review.create.mockResolvedValue({ id: 'rev-1' } as never);
    await POST(makeReq({ rating: 5 }), ctx);
    expect(prismaMock.order.findUnique.mock.calls[0]?.[0]?.where).toEqual({ trackingToken: TOKEN });
  });

  it('403s when the CSRF header is missing', async () => {
    const res = await POST(makeReq({ rating: 5 }, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('404s ORDER_NOT_FOUND when the token matches nothing', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ rating: 5 }), ctx);
    expect(res.status).toBe(404);
  });

  it('422s REVIEW_NOT_ALLOWED when the order is not DELIVERED', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      ...DELIVERED_ORDER,
      status: 'OUT_FOR_DELIVERY',
    } as never);
    const res = await POST(makeReq({ rating: 5 }), ctx);
    expect(res.status).toBe(422);
  });

  it('409s when this order was already reviewed', async () => {
    prismaMock.review.findUnique.mockResolvedValue({ id: 'rev-1' } as never);
    const res = await POST(makeReq({ rating: 5 }), ctx);
    expect(res.status).toBe(409);
  });

  it('400s on an out-of-range rating', async () => {
    const res = await POST(makeReq({ rating: 6 }), ctx);
    expect(res.status).toBe(400);
  });

  it('creates the review scoped to the order + storeId and returns 201', async () => {
    prismaMock.review.create.mockResolvedValue({ id: 'rev-1' } as never);
    const res = await POST(makeReq({ rating: 5, text: 'Excellent' }), ctx);
    expect(res.status).toBe(201);
    expect(prismaMock.review.create.mock.calls[0]?.[0]?.data).toEqual({
      orderId: 'order-1',
      storeId: 'store-1',
      rating: 5,
      text: 'Excellent',
    });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
