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
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);

function makeReq(qs = ''): NextRequest {
  return new NextRequest(`http://test/api/reviews${qs}`, { method: 'GET' });
}

function seededReview(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rev_1',
    orderId: 'order-1',
    rating: 5,
    text: 'Great!',
    visible: true,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    order: { customerName: 'Amara' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
});

describe('GET /api/reviews', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it('404s NO_STORE when the caller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('scopes the list to the caller store and includes hidden reviews for moderation', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.review.findMany.mockResolvedValue([seededReview({ visible: false })] as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const args = prismaMock.review.findMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ storeId: 'store-1' });
    expect(args?.where).not.toHaveProperty('visible');
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  it('returns items + nextCursor via the shared cursor-pagination shape', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.review.findMany.mockResolvedValue([
      seededReview({ id: 'r1' }),
      seededReview({ id: 'r2' }),
    ] as never);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.items.map((r: { id: string }) => r.id)).toEqual(['r1', 'r2']);
    expect(body.nextCursor).toBeNull();
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
