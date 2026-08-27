import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/products/ownership', () => ({
  findOwnedProduct: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { findOwnedProduct } from '@/lib/server/products/ownership';
import { PATCH, DELETE } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindOwnedProduct = vi.mocked(findOwnedProduct);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'prod-1', variantId: 'var-1' }) };
const PRODUCT = { id: 'prod-1', storeId: 'store-1' };
const VARIANT = {
  id: 'var-1',
  productId: 'prod-1',
  name: 'Size',
  value: 'Large',
  priceDeltaCents: 200,
  quantity: 5,
};

function makeReq(
  method: 'PATCH' | 'DELETE',
  body?: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/products/prod-1/variants/var-1', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockFindOwnedProduct.mockResolvedValue({ store: { id: 'store-1' }, product: PRODUCT } as never);
  prismaMock.productVariant.findFirst.mockResolvedValue(VARIANT as never);
});

describe('PATCH /api/products/[id]/variants/[variantId]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq('PATCH', { quantity: 3 }, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await PATCH(makeReq('PATCH', { quantity: 3 }), ctx);
    expect(res.status).toBe(401);
  });

  it("404s VARIANT_NOT_FOUND when the product isn't the caller's", async () => {
    mockFindOwnedProduct.mockResolvedValue({ store: null, product: null });
    const res = await PATCH(makeReq('PATCH', { quantity: 3 }), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('VARIANT_NOT_FOUND');
  });

  it("404s VARIANT_NOT_FOUND when the variant doesn't belong to this product", async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq('PATCH', { quantity: 3 }), ctx);
    expect(res.status).toBe(404);
    const args = prismaMock.productVariant.findFirst.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: 'var-1', productId: 'prod-1' });
  });

  it('400s on invalid body', async () => {
    const res = await PATCH(makeReq('PATCH', { quantity: -1 }), ctx);
    expect(res.status).toBe(400);
  });

  it('updates only the sent fields', async () => {
    prismaMock.productVariant.update.mockResolvedValue({ ...VARIANT, quantity: 8 } as never);
    const res = await PATCH(makeReq('PATCH', { quantity: 8 }), ctx);
    expect(res.status).toBe(200);
    const updateArg = prismaMock.productVariant.update.mock.calls[0]?.[0];
    expect(updateArg?.where).toEqual({ id: 'var-1' });
    expect(updateArg?.data).toEqual({ quantity: 8 });
  });

  it('accepts a fractional quantity when the parent product is a weight unit', async () => {
    mockFindOwnedProduct.mockResolvedValue({
      store: { id: 'store-1' },
      product: { ...PRODUCT, unit: 'KG' },
    } as never);
    prismaMock.productVariant.update.mockResolvedValue({ ...VARIANT, quantity: 12.09 } as never);

    const res = await PATCH(makeReq('PATCH', { quantity: 12.09 }), ctx);
    expect(res.status).toBe(200);
    const updateArg = prismaMock.productVariant.update.mock.calls[0]?.[0];
    expect(updateArg?.data).toEqual({ quantity: 12.09 });
  });

  it('400s on a fractional quantity when the parent product is a UNIT product', async () => {
    mockFindOwnedProduct.mockResolvedValue({
      store: { id: 'store-1' },
      product: { ...PRODUCT, unit: 'UNIT' },
    } as never);

    const res = await PATCH(makeReq('PATCH', { quantity: 3.5 }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/products/[id]/variants/[variantId]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await DELETE(makeReq('DELETE', undefined, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await DELETE(makeReq('DELETE'), ctx);
    expect(res.status).toBe(401);
  });

  it("404s VARIANT_NOT_FOUND when the variant isn't the caller's", async () => {
    prismaMock.productVariant.findFirst.mockResolvedValue(null);
    const res = await DELETE(makeReq('DELETE'), ctx);
    expect(res.status).toBe(404);
    expect(prismaMock.productVariant.delete).not.toHaveBeenCalled();
  });

  it('deletes the variant and returns ok', async () => {
    const res = await DELETE(makeReq('DELETE'), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.productVariant.delete).toHaveBeenCalledWith({ where: { id: 'var-1' } });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
