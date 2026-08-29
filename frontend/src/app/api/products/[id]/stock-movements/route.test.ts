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
const params = { params: Promise.resolve({ id: 'prod-1' }) };

function makeGet(qs = '') {
  return new NextRequest(`http://test/api/products/prod-1/stock-movements${qs}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ user: { sub: 'u1', email: 'e' } });
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'o1' } as never);
});

describe('GET /api/products/[id]/stock-movements', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await GET(makeGet(), params)).status).toBe(401);
  });

  it("404s when the product isn't the caller's", async () => {
    prismaMock.product.findFirst.mockResolvedValue(null);
    const res = await GET(makeGet(), params);
    expect(res.status).toBe(404);
  });

  it('returns the product ledger newest-first with a flattened variant label', async () => {
    prismaMock.product.findFirst.mockResolvedValue({ id: 'prod-1', storeId: 'store-1' } as never);
    prismaMock.stockMovement.findMany.mockResolvedValue([
      {
        id: 'm2',
        delta: -2,
        resultingQuantity: 6,
        reason: 'SALE',
        note: null,
        orderId: 'order-9',
        actorType: 'SYSTEM',
        createdAt: new Date('2026-08-02'),
        variant: { name: 'Size', value: 'M' },
      },
      {
        id: 'm1',
        delta: 8,
        resultingQuantity: 8,
        reason: 'CORRECTION',
        note: 'Opening balance',
        orderId: null,
        actorType: 'SELLER',
        createdAt: new Date('2026-08-01'),
        variant: null,
      },
    ] as never);

    const body = await (await GET(makeGet(), params)).json();
    expect(body.movements[0]).toMatchObject({
      id: 'm2',
      reason: 'SALE',
      variantLabel: 'Size: M',
      orderId: 'order-9',
    });
    expect(body.movements[1]).toMatchObject({ reason: 'CORRECTION', variantLabel: null });
    const args = prismaMock.stockMovement.findMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ productId: 'prod-1' });
    expect(args?.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});
