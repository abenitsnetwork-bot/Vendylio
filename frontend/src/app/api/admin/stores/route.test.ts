import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAdmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const adminCtx = {
  user: { sub: 'admin_1', email: 'admin@test.local' },
  admin: { id: 'admin_1', email: 'admin@test.local', role: 'ADMIN' as const },
};

function makeGet(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function storeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    slug: 'demo-store',
    name: 'Demo Store',
    published: true,
    plan: 'FREE',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    organization: { owner: { id: 'u1', email: 'seller@test.local' } },
    _count: { products: 3, orders: 5 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.store.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/stores', () => {
  it('propagates 403 from requireAdmin', async () => {
    mockRequireAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet('http://test/api/admin/stores'));
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet('http://test/api/admin/stores'));
    expect(res.status).toBe(429);
  });

  it('returns empty 200 (never 404) on no rows', async () => {
    const res = await GET(makeGet('http://test/api/admin/stores'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [], nextCursor: null });
  });

  it('flattens organization.owner and _count into the response shape', async () => {
    prismaMock.store.findMany.mockResolvedValueOnce([storeRow()] as never);
    const res = await GET(makeGet('http://test/api/admin/stores'));
    const body = await res.json();
    expect(body.items[0]).toEqual({
      id: 's1',
      slug: 'demo-store',
      name: 'Demo Store',
      published: true,
      plan: 'FREE',
      createdAt: '2026-05-01T00:00:00.000Z',
      ownerId: 'u1',
      ownerEmail: 'seller@test.local',
      productCount: 3,
      orderCount: 5,
    });
  });

  it('applies q search case-insensitive on name + slug', async () => {
    await GET(makeGet('http://test/api/admin/stores?q=demo'));
    const args = prismaMock.store.findMany.mock.calls[0]?.[0];
    const where = args?.where as Record<string, unknown>;
    expect(where['OR']).toEqual([
      { name: { contains: 'demo', mode: 'insensitive' } },
      { slug: { contains: 'demo', mode: 'insensitive' } },
    ]);
  });

  it('filters by published=true and published=false', async () => {
    await GET(makeGet('http://test/api/admin/stores?published=true'));
    let args = prismaMock.store.findMany.mock.calls[0]?.[0];
    expect((args?.where as Record<string, unknown>)['published']).toBe(true);

    await GET(makeGet('http://test/api/admin/stores?published=false'));
    args = prismaMock.store.findMany.mock.calls[1]?.[0];
    expect((args?.where as Record<string, unknown>)['published']).toBe(false);
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
