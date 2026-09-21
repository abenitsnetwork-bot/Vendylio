import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makePost(csv: string, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/products/import', {
    method: 'POST',
    headers,
    body: JSON.stringify({ csv }),
  });
}

const VALID_CSV = [
  'name,price,quantity,category',
  'Apple,1.50,10,Produce',
  'Milk,3.20,5,Dairy',
].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
  prismaMock.category.findMany.mockResolvedValue([
    { id: 'cat-produce', name: 'Produce', sortOrder: 0 },
  ] as never);
  prismaMock.category.create.mockResolvedValue({ id: 'cat-dairy', name: 'Dairy' } as never);
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
  prismaMock.product.createManyAndReturn.mockResolvedValue([
    { id: 'p1', quantity: 10 },
    { id: 'p2', quantity: 5 },
  ] as never);
  prismaMock.stockMovement.createMany.mockResolvedValue({ count: 2 } as never);
});

describe('POST /api/products/import', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost(VALID_CSV, 'missing'));
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost(VALID_CSV));
    expect(res.status).toBe(401);
  });

  it('404s with NO_STORE when the seller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await POST(makePost(VALID_CSV));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NO_STORE');
  });

  it('400s VALIDATION_FAILED when the csv field is empty', async () => {
    const res = await POST(makePost(''));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
  });

  it('400s IMPORT_VALIDATION_FAILED and creates nothing when a required column is missing', async () => {
    const res = await POST(makePost('name,quantity\nApple,10'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IMPORT_VALIDATION_FAILED');
    expect(body.rowErrors).toHaveLength(1);
    expect(prismaMock.product.createManyAndReturn).not.toHaveBeenCalled();
    expect(prismaMock.category.create).not.toHaveBeenCalled();
  });

  it('400s IMPORT_VALIDATION_FAILED and creates nothing when one row has a bad price', async () => {
    const csv = ['name,price,quantity', 'Apple,1.50,10', 'Milk,not-a-number,5'].join('\n');
    const res = await POST(makePost(csv));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IMPORT_VALIDATION_FAILED');
    expect(body.rowErrors[0]).toMatchObject({ row: 3 });
    expect(prismaMock.product.createManyAndReturn).not.toHaveBeenCalled();
  });

  it('creates products, reuses an existing category, and creates a missing one', async () => {
    const res = await POST(makePost(VALID_CSV));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ created: 2, categoriesCreated: 1 });

    // Only "Dairy" was missing — "Produce" already existed.
    expect(prismaMock.category.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Dairy', storeId: 'store-1' }),
      }),
    );

    const createArg = prismaMock.product.createManyAndReturn.mock.calls[0]?.[0] as {
      data: { name: string; categoryId?: string; priceCents: number }[];
    };
    expect(createArg.data).toHaveLength(2);
    expect(createArg.data.find((p) => p.name === 'Apple')).toMatchObject({
      priceCents: 150,
      categoryId: 'cat-produce',
    });
    expect(createArg.data.find((p) => p.name === 'Milk')).toMatchObject({
      categoryId: 'cat-dairy',
    });

    const movementArg = prismaMock.stockMovement.createMany.mock.calls[0]?.[0] as {
      data: { productId: string; delta: number; resultingQuantity: number; reason: string }[];
    };
    expect(movementArg.data).toHaveLength(2);
    expect(movementArg.data[0]).toMatchObject({
      productId: 'p1',
      delta: 10,
      resultingQuantity: 10,
      reason: 'CORRECTION',
    });
  });

  it('does not create a category row for a name that only differs by case', async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'cat-produce', name: 'produce', sortOrder: 0 },
    ] as never);
    const csv = ['name,price,quantity,category', 'Apple,1.50,10,PRODUCE'].join('\n');
    await POST(makePost(csv));
    expect(prismaMock.category.create).not.toHaveBeenCalled();
  });

  it('rejects a file over the row cap without creating anything', async () => {
    const rows = Array.from({ length: 2001 }, (_, i) => `Item ${i},1.00,1`);
    const csv = ['name,price,quantity', ...rows].join('\n');
    const res = await POST(makePost(csv));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IMPORT_VALIDATION_FAILED');
    expect(prismaMock.product.createManyAndReturn).not.toHaveBeenCalled();
  });
});
