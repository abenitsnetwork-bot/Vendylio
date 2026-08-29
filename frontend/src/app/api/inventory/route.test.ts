import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);

function makeGet(qs = '') {
  return new NextRequest(`http://test/api/inventory${qs}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ user: { sub: 'u1', email: 'e' } });
  mockResolveOwnStore.mockResolvedValue({
    id: 'store-1',
    defaultLowStockThreshold: 3,
  } as never);
});

describe('GET /api/inventory', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await GET(makeGet())).status).toBe(401);
  });

  it('404s NO_STORE without a store', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    expect((await GET(makeGet())).status).toBe(404);
  });

  it('emits one row per no-variant product with OK/LOW/OUT status against the effective threshold', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Honey',
        imageUrl: null,
        unit: 'UNIT',
        quantity: 10,
        lowStockThreshold: null,
        category: { name: 'Food' },
        variants: [],
        createdAt: new Date(),
      },
      {
        id: 'p2',
        name: 'Soap',
        imageUrl: null,
        unit: 'UNIT',
        quantity: 2,
        lowStockThreshold: null,
        category: null,
        variants: [],
        createdAt: new Date(),
      },
      {
        id: 'p3',
        name: 'Candle',
        imageUrl: null,
        unit: 'UNIT',
        quantity: 0,
        lowStockThreshold: 5,
        category: null,
        variants: [],
        createdAt: new Date(),
      },
    ] as never);

    const body = await (await GET(makeGet())).json();
    expect(
      body.rows.map((r: { productId: string; status: string }) => [r.productId, r.status]),
    ).toEqual([
      ['p1', 'OK'],
      ['p2', 'LOW'],
      ['p3', 'OUT'],
    ]);
    expect(body.rows[2].effectiveThreshold).toBe(5);
  });

  it('emits one row per variant when a product has variants (variant stock is authoritative)', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Tee',
        imageUrl: null,
        unit: 'UNIT',
        quantity: 99,
        lowStockThreshold: null,
        category: null,
        createdAt: new Date(),
        variants: [
          { id: 'v1', name: 'Size', value: 'S', quantity: 1, createdAt: new Date() },
          { id: 'v2', name: 'Size', value: 'M', quantity: 20, createdAt: new Date() },
        ],
      },
    ] as never);

    const body = await (await GET(makeGet())).json();
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0]).toMatchObject({ variantId: 'v1', variantLabel: 'Size: S', status: 'LOW' });
    expect(body.rows[1]).toMatchObject({ variantId: 'v2', status: 'OK' });
  });

  it('filter=low keeps only LOW rows', async () => {
    prismaMock.product.findMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'A',
        imageUrl: null,
        unit: 'UNIT',
        quantity: 100,
        lowStockThreshold: null,
        category: null,
        variants: [],
        createdAt: new Date(),
      },
      {
        id: 'p2',
        name: 'B',
        imageUrl: null,
        unit: 'UNIT',
        quantity: 1,
        lowStockThreshold: null,
        category: null,
        variants: [],
        createdAt: new Date(),
      },
    ] as never);
    const body = await (await GET(makeGet('?filter=low')).then((r) => r)).json();
    expect(body.rows.map((r: { productId: string }) => r.productId)).toEqual(['p2']);
  });

  it('passes q + categoryId filters into the product query', async () => {
    prismaMock.product.findMany.mockResolvedValue([] as never);
    await GET(makeGet('?q=hon&categoryId=__none__'));
    const where = prismaMock.product.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where).toMatchObject({
      storeId: 'store-1',
      name: { contains: 'hon', mode: 'insensitive' },
      categoryId: null,
    });
  });
});
