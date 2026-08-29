import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
vi.mock('@/lib/server/inventory/adjust', () => ({ applyStockChange: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { applyStockChange } from '@/lib/server/inventory/adjust';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const mockApplyStockChange = vi.mocked(applyStockChange);

function makePost(body: unknown, csrf: 'match' | 'missing' = 'match') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/inventory/adjust', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ user: { sub: 'u1', email: 'e' } });
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', defaultLowStockThreshold: 3 } as never);
  mockApplyStockChange.mockResolvedValue({
    before: 10,
    after: 7,
    delta: -3,
    effectiveThreshold: 3,
    crossedLowThreshold: false,
    crossedZero: false,
  });
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
  prismaMock.product.findMany.mockResolvedValue([
    { id: 'p1', unit: 'UNIT', variants: [{ id: 'v1' }] },
  ] as never);
});

describe('POST /api/inventory/adjust', () => {
  it('403s without the CSRF header', async () => {
    const res = await POST(makePost({ adjustments: [] }, 'missing'));
    expect(res.status).toBe(403);
  });

  it('400s on an empty adjustments array', async () => {
    const res = await POST(makePost({ adjustments: [] }));
    expect(res.status).toBe(400);
  });

  it('400s when a line has both delta and newQuantity', async () => {
    const res = await POST(
      makePost({ adjustments: [{ productId: 'p1', delta: 1, newQuantity: 2, reason: 'RESTOCK' }] }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a system-only reason (SALE)', async () => {
    const res = await POST(
      makePost({ adjustments: [{ productId: 'p1', delta: -1, reason: 'SALE' }] }),
    );
    expect(res.status).toBe(400);
  });

  it('404s when a line references a product from another store', async () => {
    const res = await POST(
      makePost({ adjustments: [{ productId: 'not-mine', delta: 1, reason: 'RESTOCK' }] }),
    );
    expect(res.status).toBe(404);
    expect(mockApplyStockChange).not.toHaveBeenCalled();
  });

  it('404s when a variantId does not belong to the product', async () => {
    const res = await POST(
      makePost({
        adjustments: [{ productId: 'p1', variantId: 'wrong', delta: 1, reason: 'RESTOCK' }],
      }),
    );
    expect(res.status).toBe(404);
  });

  it('runs every valid line through applyStockChange (SELLER) in one call and returns per-line results', async () => {
    const res = await POST(
      makePost({
        adjustments: [
          { productId: 'p1', delta: 5, reason: 'RESTOCK', note: 'delivery' },
          { productId: 'p1', variantId: 'v1', newQuantity: 0, reason: 'CORRECTION' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(mockApplyStockChange).toHaveBeenCalledTimes(2);
    expect(mockApplyStockChange).toHaveBeenNthCalledWith(
      1,
      prismaMock,
      expect.objectContaining({
        productId: 'p1',
        delta: 5,
        reason: 'RESTOCK',
        actorType: 'SELLER',
        note: 'delivery',
      }),
    );
    expect(mockApplyStockChange).toHaveBeenNthCalledWith(
      2,
      prismaMock,
      expect.objectContaining({ productId: 'p1', variantId: 'v1', newQuantity: 0 }),
    );
    const body = await res.json();
    expect(body.results).toHaveLength(2);
  });

  it('400s a fractional newQuantity for a per-item product', async () => {
    const res = await POST(
      makePost({ adjustments: [{ productId: 'p1', newQuantity: 2.5, reason: 'CORRECTION' }] }),
    );
    expect(res.status).toBe(400);
  });
});
