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
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindOwnedProduct = vi.mocked(findOwnedProduct);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'prod-1' }) };
const PRODUCT = { id: 'prod-1', storeId: 'store-1' };

function makeReq(body?: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/products/prod-1/variants', {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockFindOwnedProduct.mockResolvedValue({ store: { id: 'store-1' }, product: PRODUCT } as never);
});

describe('POST /api/products/[id]/variants', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makeReq({ name: 'Size', value: 'Large' }, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makeReq({ name: 'Size', value: 'Large' }), ctx);
    expect(res.status).toBe(401);
  });

  it("404s PRODUCT_NOT_FOUND when the product isn't the caller's", async () => {
    mockFindOwnedProduct.mockResolvedValue({ store: null, product: null });
    const res = await POST(makeReq({ name: 'Size', value: 'Large' }), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PRODUCT_NOT_FOUND');
  });

  it('400s on invalid body (missing value)', async () => {
    const res = await POST(makeReq({ name: 'Size' }), ctx);
    expect(res.status).toBe(400);
  });

  it('creates the variant scoped to the product and defaults priceDeltaCents/quantity to 0', async () => {
    prismaMock.productVariant.create.mockResolvedValue({
      id: 'var-1',
      productId: 'prod-1',
      name: 'Size',
      value: 'Large',
      priceDeltaCents: 0,
      quantity: 0,
    } as never);

    const res = await POST(makeReq({ name: 'Size', value: 'Large' }), ctx);
    expect(res.status).toBe(201);
    const createArg = prismaMock.productVariant.create.mock.calls[0]?.[0];
    expect(createArg?.data).toEqual({
      productId: 'prod-1',
      name: 'Size',
      value: 'Large',
      priceDeltaCents: 0,
      quantity: 0,
    });
  });

  it('accepts an explicit priceDeltaCents and quantity', async () => {
    prismaMock.productVariant.create.mockResolvedValue({ id: 'var-1' } as never);
    await POST(
      makeReq({ name: 'Weight', value: '1kg bag', priceDeltaCents: 500, quantity: 20 }),
      ctx,
    );
    const createArg = prismaMock.productVariant.create.mock.calls[0]?.[0];
    expect(createArg?.data).toMatchObject({ priceDeltaCents: 500, quantity: 20 });
  });

  it('accepts a fractional quantity when the parent product is a weight unit', async () => {
    mockFindOwnedProduct.mockResolvedValue({
      store: { id: 'store-1' },
      product: { ...PRODUCT, unit: 'KG' },
    } as never);
    prismaMock.productVariant.create.mockResolvedValue({ id: 'var-1' } as never);

    await POST(makeReq({ name: 'Weight', value: '1kg bag', quantity: 12.09 }), ctx);
    const createArg = prismaMock.productVariant.create.mock.calls[0]?.[0];
    expect(createArg?.data).toMatchObject({ quantity: 12.09 });
  });

  it('400s on a fractional quantity when the parent product is a UNIT product', async () => {
    mockFindOwnedProduct.mockResolvedValue({
      store: { id: 'store-1' },
      product: { ...PRODUCT, unit: 'UNIT' },
    } as never);

    const res = await POST(makeReq({ name: 'Size', value: 'Large', quantity: 3.5 }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
