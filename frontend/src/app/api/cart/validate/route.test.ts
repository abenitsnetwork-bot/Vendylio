import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware/rate-limit-by-ip', () => ({
  quoteIpLimiter: { check: async () => null },
}));

import { POST } from './route';

function makeReq(body: unknown, csrf: 'match' | 'missing' = 'match') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'tok';
  return new NextRequest('http://test/api/cart/validate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const STORE = {
  id: 'store-1',
  slug: 'shea',
  published: true,
  ordersPaused: false,
  pauseMessage: null,
};

function product(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Shea Butter',
    priceCents: 1200,
    quantity: 10,
    status: 'ACTIVE',
    variants: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findFirst.mockResolvedValue(STORE as never);
  prismaMock.product.findMany.mockResolvedValue([product()] as never);
});

describe('POST /api/cart/validate', () => {
  it('403s without the CSRF header', async () => {
    expect((await POST(makeReq({ storeSlug: 'shea', items: [] }, 'missing'))).status).toBe(403);
  });

  it('400s on an empty items array', async () => {
    expect((await POST(makeReq({ storeSlug: 'shea', items: [] }))).status).toBe(400);
  });

  it('reports an all-clear cart with no changes', async () => {
    const res = await POST(
      makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', quantity: 2, priceCents: 1200 }] }),
    );
    const body = await res.json();
    expect(body.storeOk).toBe(true);
    expect(body.acceptingOrders).toBe(true);
    expect(body.hasBlockingChange).toBe(false);
    expect(body.lines[0]).toMatchObject({ ok: true, changes: [], adjustedQuantity: 2 });
  });

  it('storeOk:false + blocking when the store is gone / unpublished', async () => {
    prismaMock.store.findFirst.mockResolvedValueOnce(null);
    const body = await (
      await POST(makeReq({ storeSlug: 'gone', items: [{ productId: 'p1', quantity: 1 }] }))
    ).json();
    expect(body).toMatchObject({ storeOk: false, hasBlockingChange: true });
  });

  it('flags REMOVED for a product that is not in the store (or archived)', async () => {
    prismaMock.product.findMany.mockResolvedValueOnce([] as never);
    const body = await (
      await POST(makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', quantity: 1 }] }))
    ).json();
    expect(body.lines[0].changes).toEqual(['REMOVED']);
    expect(body.lines[0].ok).toBe(false);
    expect(body.hasBlockingChange).toBe(true);
  });

  it('flags OPTION_UNAVAILABLE when the chosen variant is gone', async () => {
    prismaMock.product.findMany.mockResolvedValueOnce([
      product({
        variants: [{ id: 'v2', name: 'Size', value: 'L', priceDeltaCents: 0, quantity: 3 }],
      }),
    ] as never);
    const body = await (
      await POST(
        makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] }),
      )
    ).json();
    expect(body.lines[0].changes).toEqual(['OPTION_UNAVAILABLE']);
  });

  it('flags OUT_OF_STOCK and zeroes the quantity', async () => {
    prismaMock.product.findMany.mockResolvedValueOnce([product({ quantity: 0 })] as never);
    const body = await (
      await POST(makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', quantity: 2 }] }))
    ).json();
    expect(body.lines[0].changes).toContain('OUT_OF_STOCK');
    expect(body.lines[0].adjustedQuantity).toBe(0);
    expect(body.lines[0].ok).toBe(false);
  });

  it('flags STOCK_REDUCED and clamps to what is left (non-blocking)', async () => {
    prismaMock.product.findMany.mockResolvedValueOnce([product({ quantity: 3 })] as never);
    const body = await (
      await POST(makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', quantity: 8 }] }))
    ).json();
    expect(body.lines[0].changes).toContain('STOCK_REDUCED');
    expect(body.lines[0].adjustedQuantity).toBe(3);
    expect(body.lines[0].ok).toBe(true);
    expect(body.hasBlockingChange).toBe(false);
  });

  it('flags PRICE_INCREASED / PRICE_DECREASED against the client price', async () => {
    prismaMock.product.findMany.mockResolvedValue([product({ priceCents: 1500 })] as never);
    const up = await (
      await POST(
        makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', quantity: 1, priceCents: 1200 }] }),
      )
    ).json();
    expect(up.lines[0].changes).toContain('PRICE_INCREASED');
    expect(up.hasPriceIncrease).toBe(true);
    expect(up.lines[0].currentPriceCents).toBe(1500);

    const down = await (
      await POST(
        makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', quantity: 1, priceCents: 1800 }] }),
      )
    ).json();
    expect(down.lines[0].changes).toContain('PRICE_DECREASED');
    expect(down.hasPriceIncrease).toBe(false);
  });

  it('marks the whole cart blocking when the store paused orders', async () => {
    prismaMock.store.findFirst.mockResolvedValueOnce({
      ...STORE,
      ordersPaused: true,
      pauseMessage: 'Back Monday',
    } as never);
    const body = await (
      await POST(makeReq({ storeSlug: 'shea', items: [{ productId: 'p1', quantity: 1 }] }))
    ).json();
    expect(body.acceptingOrders).toBe(false);
    expect(body.pauseMessage).toBe('Back Monday');
    expect(body.hasBlockingChange).toBe(true);
  });
});
