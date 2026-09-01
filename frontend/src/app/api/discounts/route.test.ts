import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

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
  return new NextRequest('http://test/api/discounts', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({
    id: 'store-1',
    organizationId: 'org-1',
    plan: 'PRO',
  } as never);
  prismaMock.discount.findMany.mockResolvedValue([]);
});

describe('GET /api/discounts', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await GET(makeReq('GET'))).status).toBe(401);
  });

  it('404s NO_STORE when the seller has no store', async () => {
    mockResolveOwnStore.mockResolvedValueOnce(null);
    const res = await GET(makeReq('GET'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NO_STORE');
  });

  it('returns the store’s codes scoped + newest first', async () => {
    await GET(makeReq('GET'));
    const arg = prismaMock.discount.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ storeId: 'store-1' });
    expect(arg?.orderBy).toEqual({ createdAt: 'desc' });
  });
});

describe('POST /api/discounts', () => {
  it('403s without the CSRF header', async () => {
    expect((await POST(makeReq('POST', { code: 'FREESHIP' }, 'missing'))).status).toBe(403);
  });

  it('400s on a code with spaces', async () => {
    const res = await POST(makeReq('POST', { code: 'FREE SHIP' }));
    expect(res.status).toBe(400);
  });

  it('400s when endsAt is before startsAt', async () => {
    const res = await POST(
      makeReq('POST', {
        code: 'FREESHIP',
        startsAt: '2026-12-10T00:00:00Z',
        endsAt: '2026-12-01T00:00:00Z',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('creates the code uppercased, kind forced to FREE_DELIVERY', async () => {
    prismaMock.discount.create.mockResolvedValue({
      id: 'd1',
      code: 'FREESHIP',
      kind: 'FREE_DELIVERY',
      active: true,
      startsAt: null,
      endsAt: null,
      minSubtotalCents: 3000,
      maxRedemptions: 100,
      redemptionCount: 0,
      createdAt: new Date(),
    } as never);

    const res = await POST(
      makeReq('POST', { code: 'freeship', minSubtotalCents: 3000, maxRedemptions: 100 }),
    );
    expect(res.status).toBe(201);
    const data = prismaMock.discount.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({
      storeId: 'store-1',
      code: 'FREESHIP',
      kind: 'FREE_DELIVERY',
      minSubtotalCents: 3000,
      maxRedemptions: 100,
    });
  });

  it('409 CODE_TAKEN on a unique-constraint hit', async () => {
    prismaMock.discount.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    const res = await POST(makeReq('POST', { code: 'FREESHIP' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('CODE_TAKEN');
  });

  // Phase 3 — promo codes are Pro-only.
  it('402 PLAN_UPGRADE_REQUIRED for a FREE store', async () => {
    mockResolveOwnStore.mockResolvedValueOnce({
      id: 'store-1',
      organizationId: 'org-1',
      plan: 'FREE',
    } as never);
    const res = await POST(makeReq('POST', { code: 'FREESHIP' }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('PLAN_UPGRADE_REQUIRED');
    expect(body.feature).toBe('promoCodes');
    expect(prismaMock.discount.create).not.toHaveBeenCalled();
  });
});
