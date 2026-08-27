import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET, PATCH, DELETE } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'prod-1' }) };

function makeReq(
  method: 'PATCH' | 'DELETE',
  body?: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/products/prod-1', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
});

describe('GET /api/products/[id]', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeReq('PATCH'), ctx);
    expect(res.status).toBe(401);
  });

  it("404s when the product isn't the caller's", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    const res = await GET(makeReq('PATCH'), ctx);
    expect(res.status).toBe(404);
  });

  it('returns the product when owned by the caller', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    const res = await GET(makeReq('PATCH'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.product.id).toBe('prod-1');
  });

  it('includes the product variants (Phase 7)', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    prismaMock.productVariant.findMany.mockResolvedValue([
      { id: 'var-1', name: 'Size', value: 'Large' },
    ] as never);
    const res = await GET(makeReq('PATCH'), ctx);
    const body = await res.json();
    expect(body.variants).toEqual([{ id: 'var-1', name: 'Size', value: 'Large' }]);
    const args = prismaMock.productVariant.findMany.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ productId: 'prod-1' });
  });
});

describe('PATCH /api/products/[id]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq('PATCH', { name: 'New name' }, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await PATCH(makeReq('PATCH', { name: 'New name' }), ctx);
    expect(res.status).toBe(401);
  });

  it('404s with PRODUCT_NOT_FOUND when the seller has no store', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await PATCH(makeReq('PATCH', { name: 'New name' }), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('PRODUCT_NOT_FOUND');
  });

  it("404s with PRODUCT_NOT_FOUND when the product belongs to another seller's store", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq('PATCH', { name: 'New name' }), ctx);
    expect(res.status).toBe(404);
    const args = prismaMock.product.findFirst.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: 'prod-1', storeId: 'store-1' });
  });

  it('400s on invalid body', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    const res = await PATCH(makeReq('PATCH', { priceCents: -5 }), ctx);
    expect(res.status).toBe(400);
  });

  it('updates only the sent fields, e.g. clearing imageUrl to null', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    prismaMock.product.update.mockResolvedValue({ id: 'prod-1', imageUrl: null } as never);

    const res = await PATCH(makeReq('PATCH', { imageUrl: null }), ctx);
    expect(res.status).toBe(200);
    const updateArg = prismaMock.product.update.mock.calls[0]?.[0];
    expect(updateArg?.where).toEqual({ id: 'prod-1' });
    expect(updateArg?.data).toEqual({ imageUrl: null });
  });

  it('accepts a unit change (Phase 7)', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    prismaMock.product.update.mockResolvedValue({ id: 'prod-1', unit: 'KG' } as never);

    const res = await PATCH(makeReq('PATCH', { unit: 'KG' }), ctx);
    expect(res.status).toBe(200);
    const updateArg = prismaMock.product.update.mock.calls[0]?.[0];
    expect(updateArg?.data).toEqual({ unit: 'KG' });
  });

  it('400s on an invalid unit', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    const res = await PATCH(makeReq('PATCH', { unit: 'POUNDS' }), ctx);
    expect(res.status).toBe(400);
  });

  it('accepts a fractional quantity when the product is already a weight unit', async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      storeId: 'store-1',
      unit: 'KG',
    } as never);
    prismaMock.product.update.mockResolvedValue({ id: 'prod-1', quantity: 12.09 } as never);

    const res = await PATCH(makeReq('PATCH', { quantity: 12.09 }), ctx);
    expect(res.status).toBe(200);
    const updateArg = prismaMock.product.update.mock.calls[0]?.[0];
    expect(updateArg?.data).toEqual({ quantity: 12.09 });
  });

  it('400s on a fractional quantity for a UNIT product', async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      storeId: 'store-1',
      unit: 'UNIT',
    } as never);
    const res = await PATCH(makeReq('PATCH', { quantity: 3.5 }), ctx);
    expect(res.status).toBe(400);
  });

  it('400s on a fractional quantity when unit is switched to UNIT in the same request', async () => {
    prismaMock.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      storeId: 'store-1',
      unit: 'KG',
    } as never);
    const res = await PATCH(makeReq('PATCH', { unit: 'UNIT', quantity: 3.5 }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/products/[id]', () => {
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

  it("404s with PRODUCT_NOT_FOUND when the product isn't the caller's", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    const res = await DELETE(makeReq('DELETE'), ctx);
    expect(res.status).toBe(404);
    expect(prismaMock.product.delete).not.toHaveBeenCalled();
  });

  it('deletes the product and returns ok', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    const res = await DELETE(makeReq('DELETE'), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.product.delete).toHaveBeenCalledWith({ where: { id: 'prod-1' } });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
