import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/customers/ownership', () => ({
  findOwnedCustomer: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { findOwnedCustomer } from '@/lib/server/customers/ownership';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockFindOwnedCustomer = vi.mocked(findOwnedCustomer);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'cust-1' }) };

const CUSTOMER = {
  id: 'cust-1',
  storeId: 'store-1',
  email: 'amara@example.com',
  phone: '+15551234567',
  name: 'Amara',
  address: null,
  totalSpentCents: 3600,
  ordersCount: 1,
};

function makeReq(): NextRequest {
  return new NextRequest('http://test/api/customers/cust-1', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockFindOwnedCustomer.mockResolvedValue({
    store: { id: 'store-1' },
    customer: CUSTOMER,
  } as never);
});

describe('GET /api/customers/[id]', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(401);
  });

  it("404s CUSTOMER_NOT_FOUND when the customer isn't the caller's", async () => {
    mockFindOwnedCustomer.mockResolvedValue({ store: null, customer: null });
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('CUSTOMER_NOT_FOUND');
  });

  it('matches order history by phone OR email, scoped to the store', async () => {
    prismaMock.order.findMany.mockResolvedValue([]);

    await GET(makeReq(), ctx);

    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(args?.where).toEqual({
      storeId: 'store-1',
      OR: [{ customerPhone: '+15551234567' }, { customerEmail: 'amara@example.com' }],
    });
  });

  it('skips the order query entirely when the customer has neither phone nor email', async () => {
    mockFindOwnedCustomer.mockResolvedValue({
      store: { id: 'store-1' },
      customer: { ...CUSTOMER, phone: null, email: null },
    } as never);

    const res = await GET(makeReq(), ctx);
    const body = await res.json();

    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
    expect(body.orders).toEqual([]);
  });

  it('returns the customer + its order history', async () => {
    prismaMock.order.findMany.mockResolvedValue([{ id: 'order-1' }] as never);

    const res = await GET(makeReq(), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.customer.id).toBe('cust-1');
    expect(body.orders).toEqual([{ id: 'order-1' }]);
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
