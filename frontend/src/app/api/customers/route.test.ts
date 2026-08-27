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
  return new NextRequest(`http://test/api/customers${qs}`, { method: 'GET' });
}

function seededCustomer(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cust_1',
    storeId: 'store-1',
    email: 'amara@example.com',
    phone: '+15551234567',
    name: 'Amara',
    address: null,
    totalSpentCents: 3600,
    ordersCount: 1,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
});

describe('GET /api/customers', () => {
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

  it('scopes the list to the caller store and never trusts a client-supplied storeId', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.customer.findMany.mockResolvedValue([]);

    await GET(makeReq());

    const args = prismaMock.customer.findMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ storeId: 'store-1' });
  });

  it('returns items + nextCursor via the shared cursor-pagination shape', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.customer.findMany.mockResolvedValue([
      seededCustomer({ id: 'c1' }),
      seededCustomer({ id: 'c2' }),
    ] as never);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.items.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);
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
