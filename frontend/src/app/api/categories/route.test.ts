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
import { GET, POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeReq(method: 'GET' | 'POST', body?: unknown, csrf: 'match' | 'missing' = 'match') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/categories', {
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

describe('GET /api/categories', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(401);
  });

  it('404s NO_STORE when the seller has no store', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NO_STORE');
  });

  it('returns the store’s categories ordered, with product counts', async () => {
    prismaMock.category.findMany.mockResolvedValue([
      { id: 'c1', name: 'Food', slug: 'food', sortOrder: 0, _count: { products: 3 } },
      { id: 'c2', name: 'Crafts', slug: 'crafts', sortOrder: 1, _count: { products: 0 } },
    ] as never);
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toEqual([
      { id: 'c1', name: 'Food', slug: 'food', sortOrder: 0, productCount: 3 },
      { id: 'c2', name: 'Crafts', slug: 'crafts', sortOrder: 1, productCount: 0 },
    ]);
    const args = prismaMock.category.findMany.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ storeId: 'store-1' });
  });
});

describe('POST /api/categories', () => {
  it('403s when the CSRF header is missing', async () => {
    const res = await POST(makeReq('POST', { name: 'Drinks' }, 'missing'));
    expect(res.status).toBe(403);
  });

  it('400s VALIDATION_FAILED on an empty name', async () => {
    const res = await POST(makeReq('POST', { name: '   ' }));
    expect(res.status).toBe(400);
  });

  it('creates the category scoped to the store with the next sortOrder', async () => {
    prismaMock.category.findFirst.mockResolvedValue({ sortOrder: 2 } as never);
    prismaMock.category.create.mockResolvedValue({
      id: 'c9',
      name: 'Drinks & Juices',
      slug: 'drinks-juices',
      sortOrder: 3,
    } as never);

    const res = await POST(makeReq('POST', { name: 'Drinks & Juices' }));
    expect(res.status).toBe(201);
    const createArg = prismaMock.category.create.mock.calls[0]?.[0];
    expect(createArg?.data).toMatchObject({
      storeId: 'store-1',
      name: 'Drinks & Juices',
      slug: 'drinks-juices',
      sortOrder: 3,
    });
  });

  it('persists an emoji icon when supplied', async () => {
    prismaMock.category.findFirst.mockResolvedValue({ sortOrder: 0 } as never);
    prismaMock.category.create.mockResolvedValue({
      id: 'c9',
      name: 'Breads',
      slug: 'breads',
      icon: '🍞',
      sortOrder: 1,
    } as never);

    const res = await POST(makeReq('POST', { name: 'Breads', icon: '🍞' }));
    expect(res.status).toBe(201);
    expect(prismaMock.category.create.mock.calls[0]?.[0]?.data).toMatchObject({ icon: '🍞' });
    expect((await res.json()).category.icon).toBe('🍞');
  });

  it('auto-suffixes the slug on a collision with an existing category', async () => {
    prismaMock.category.findFirst.mockResolvedValue(null);
    let attempt = 0;
    prismaMock.category.create.mockImplementation((() => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(
          Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
        );
      }
      return Promise.resolve({ id: 'c9', name: 'Other', slug: 'other-2', sortOrder: 1 });
    }) as never);

    const res = await POST(makeReq('POST', { name: 'Other' }));
    expect(res.status).toBe(201);
    expect((await res.json()).category.slug).toBe('other-2');
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and verifyCsrf", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('verifyCsrf');
  });
});
