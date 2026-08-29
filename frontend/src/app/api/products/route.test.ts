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
import { POST, GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

const validBody = {
  name: 'Shea Butter 250g',
  priceCents: 1800,
  quantity: 10,
};

function makePost(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/products', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
  // POST wraps create + opening-balance stock movement in a $transaction —
  // run the callback against the same mock client.
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
});

describe('POST /api/products', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost(validBody, 'missing'));
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(401);
  });

  it('404s with NO_STORE when the seller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('400s VALIDATION_FAILED on a categoryId that is not one of the store’s categories', async () => {
    prismaMock.category.findFirst.mockResolvedValue(null as never);
    const res = await POST(makePost({ ...validBody, categoryId: 'not-mine' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('attaches a valid categoryId to the created product', async () => {
    prismaMock.category.findFirst.mockResolvedValue({ id: 'cat-1' } as never);
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost({ ...validBody, categoryId: 'cat-1' }));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.categoryId).toBe('cat-1');
  });

  it('400s on non-integer priceCents', async () => {
    const res = await POST(makePost({ ...validBody, priceCents: 18.5 }));
    expect(res.status).toBe(400);
  });

  it('creates the product scoped to the caller store and returns 201', async () => {
    prismaMock.product.create.mockResolvedValue({
      id: 'prod-1',
      storeId: 'store-1',
      ...validBody,
    } as never);
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(201);
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.storeId).toBe('store-1');
    expect(createArg?.data?.name).toBe('Shea Butter 250g');
  });

  it('defaults unit to UNIT when omitted (Phase 7)', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost(validBody));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.unit).toBe('UNIT');
  });

  it('accepts an explicit weight unit (Phase 7)', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost({ ...validBody, unit: 'KG' }));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.unit).toBe('KG');
  });

  it('400s on an invalid unit', async () => {
    const res = await POST(makePost({ ...validBody, unit: 'POUNDS' }));
    expect(res.status).toBe(400);
  });

  it('accepts a fractional quantity for a weight unit (e.g. 12.09 lb)', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost({ ...validBody, unit: 'LB', quantity: 12.09 }));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.quantity).toBe(12.09);
  });

  it('rounds a fractional quantity to 2 decimal places', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost({ ...validBody, unit: 'KG', quantity: 12.0949999 }));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.quantity).toBe(12.09);
  });

  it('400s on a fractional quantity for a per-item (UNIT) product', async () => {
    const res = await POST(makePost({ ...validBody, quantity: 3.5 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/products', () => {
  function makeGet(qs = ''): NextRequest {
    return new NextRequest(`http://test/api/products${qs}`, { method: 'GET' });
  }

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('404s with NO_STORE when the seller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('lists products scoped to the caller store, newest first, with a null nextCursor when the page fits', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'prod-1', storeId: 'store-1', createdAt: new Date() },
    ] as never);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.products).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    const args = prismaMock.product.findMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ storeId: 'store-1' });
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('applies q / categoryId / status filters', async () => {
    prismaMock.product.findMany.mockResolvedValue([] as never);
    await GET(makeGet('?q=shea&categoryId=cat-1&status=ARCHIVED'));
    const where = prismaMock.product.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where).toMatchObject({
      storeId: 'store-1',
      name: { contains: 'shea', mode: 'insensitive' },
      categoryId: 'cat-1',
      status: 'ARCHIVED',
    });
  });

  it('categoryId=__none__ filters to uncategorized products', async () => {
    prismaMock.product.findMany.mockResolvedValue([] as never);
    await GET(makeGet('?categoryId=__none__'));
    const where = prismaMock.product.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.categoryId).toBeNull();
  });

  it('emits a nextCursor when there is another page', async () => {
    // limit defaults to 20 → route asks for 21; return 21 rows
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `prod-${i}`,
      storeId: 'store-1',
      createdAt: new Date(Date.now() - i * 1000),
    }));
    prismaMock.product.findMany.mockResolvedValue(rows as never);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.products).toHaveLength(20);
    expect(body.nextCursor).toEqual(expect.any(String));
  });

  it('includes ARCHIVED products by default — this is the seller management view, not the public storefront', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      { id: 'prod-1', storeId: 'store-1', status: 'ACTIVE', createdAt: new Date() },
      { id: 'prod-2', storeId: 'store-1', status: 'ARCHIVED', createdAt: new Date() },
    ] as never);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.products.map((p: { status: string }) => p.status)).toEqual(['ACTIVE', 'ARCHIVED']);
    const args = prismaMock.product.findMany.mock.calls[0]?.[0];
    expect(args?.where).not.toHaveProperty('status');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
