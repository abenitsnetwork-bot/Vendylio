import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from './route';

const ctx = { params: Promise.resolve({ id: 'order-1' }) };

function makeReq(): NextRequest {
  return new NextRequest('http://test/api/orders/order-1/track', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/orders/[id]/track', () => {
  it('is public — no auth call at all', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'PAID',
      amount: 3600,
      currency: 'USD',
      lineItems: [],
      createdAt: new Date(),
      paidAt: new Date(),
    } as never);
    prismaMock.review.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(200);
  });

  it("404s ORDER_NOT_FOUND when the order doesn't exist", async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('ORDER_NOT_FOUND');
  });

  it('never selects commissionAmount/netAmount (seller-financial fields must not reach a guest)', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', status: 'PAID' } as never);
    prismaMock.review.findUnique.mockResolvedValue(null);

    await GET(makeReq(), ctx);

    const args = prismaMock.order.findUnique.mock.calls[0]?.[0];
    expect(args?.select).not.toHaveProperty('commissionAmount');
    expect(args?.select).not.toHaveProperty('netAmount');
    expect(args?.select).not.toHaveProperty('customerPhone');
    expect(args?.select).not.toHaveProperty('customerEmail');
  });

  it('reports hasReview=true once a Review row exists for this order', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', status: 'DELIVERED' } as never);
    prismaMock.review.findUnique.mockResolvedValue({ id: 'rev-1' } as never);

    const res = await GET(makeReq(), ctx);
    const body = await res.json();
    expect(body.hasReview).toBe(true);
  });

  it('reports hasReview=false when no Review exists yet', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', status: 'DELIVERED' } as never);
    prismaMock.review.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq(), ctx);
    const body = await res.json();
    expect(body.hasReview).toBe(false);
  });

  it('selects provider + the store contact fields a manual-payment buyer needs to pay', async () => {
    prismaMock.order.findUnique.mockResolvedValue({ id: 'order-1', status: 'PENDING' } as never);
    prismaMock.review.findUnique.mockResolvedValue(null);

    await GET(makeReq(), ctx);
    const args = prismaMock.order.findUnique.mock.calls[0]?.[0];
    expect(args?.select).toMatchObject({
      provider: true,
      store: { select: { cashAppCashtag: true, zelleContact: true } },
    });
  });

  it('surfaces the manual-payment contact info to a guest for a PENDING cashapp_manual order', async () => {
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'PENDING',
      provider: 'cashapp_manual',
      store: { cashAppCashtag: 'AdaezeShop', zelleContact: null },
    } as never);
    prismaMock.review.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq(), ctx);
    const body = await res.json();
    expect(body.order.provider).toBe('cashapp_manual');
    expect(body.order.store).toEqual({ cashAppCashtag: 'AdaezeShop', zelleContact: null });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
