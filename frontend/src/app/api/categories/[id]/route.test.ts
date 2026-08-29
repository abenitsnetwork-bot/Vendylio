import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { PATCH, DELETE } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeReq(method: 'PATCH' | 'DELETE', body?: unknown, csrf: 'match' | 'missing' = 'match') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/categories/c1', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
});

describe('PATCH /api/categories/[id]', () => {
  it('404s when the category belongs to another store', async () => {
    prismaMock.category.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq('PATCH', { name: 'x' }), params('c1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('CATEGORY_NOT_FOUND');
  });

  it('renames and re-slugs the category', async () => {
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'c1',
      storeId: 'store-1',
      name: 'Food',
      slug: 'food',
      sortOrder: 0,
    } as never);
    prismaMock.category.update.mockResolvedValue({
      id: 'c1',
      name: 'Food & Spices',
      slug: 'food-spices',
      sortOrder: 0,
    } as never);

    const res = await PATCH(makeReq('PATCH', { name: 'Food & Spices' }), params('c1'));
    expect(res.status).toBe(200);
    const updateArg = prismaMock.category.update.mock.calls[0]?.[0];
    expect(updateArg?.data).toMatchObject({ name: 'Food & Spices', slug: 'food-spices' });
  });

  it('updates sortOrder only', async () => {
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'c1',
      storeId: 'store-1',
      name: 'Food',
      slug: 'food',
      sortOrder: 0,
    } as never);
    prismaMock.category.update.mockResolvedValue({
      id: 'c1',
      name: 'Food',
      slug: 'food',
      sortOrder: 5,
    } as never);

    const res = await PATCH(makeReq('PATCH', { sortOrder: 5 }), params('c1'));
    expect(res.status).toBe(200);
    expect(prismaMock.category.update.mock.calls[0]?.[0]?.data).toEqual({ sortOrder: 5 });
  });
});

describe('DELETE /api/categories/[id]', () => {
  it('404s when the category is not the caller’s', async () => {
    prismaMock.category.findFirst.mockResolvedValue(null);
    const res = await DELETE(makeReq('DELETE'), params('c1'));
    expect(res.status).toBe(404);
  });

  it('re-parents the category’s products to null, then deletes it', async () => {
    prismaMock.category.findFirst.mockResolvedValue({
      id: 'c1',
      storeId: 'store-1',
      name: 'Food',
      slug: 'food',
      sortOrder: 0,
    } as never);
    prismaMock.$transaction.mockResolvedValue([{ count: 4 }, { id: 'c1' }] as never);

    const res = await DELETE(makeReq('DELETE'), params('c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, productsReassigned: 4 });
    expect(prismaMock.$transaction).toHaveBeenCalledOnce();
  });
});
