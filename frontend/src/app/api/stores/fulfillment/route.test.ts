import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);

const STORE = {
  id: 'store-1',
  plan: 'PRO',
  fulfillmentConfig: {},
  deliveryProvider: 'self_manual',
  deliveryFeeCents: 500,
};

function req(
  method: 'GET' | 'PATCH',
  body?: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'tok';
  return new NextRequest('http://test/api/stores/fulfillment', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ user: { sub: 'u1', email: 'a@b.c' } } as never);
  mockResolveOwnStore.mockResolvedValue(STORE as never);
  prismaMock.store.update.mockResolvedValue({} as never);
});

describe('GET /api/stores/fulfillment', () => {
  it('401s when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'x' }, { status: 401 }) as never,
    );
    expect((await GET(req('GET'))).status).toBe(401);
  });

  it('404s when the caller has no store', async () => {
    mockResolveOwnStore.mockResolvedValueOnce(null);
    expect((await GET(req('GET'))).status).toBe(404);
  });

  it('returns the normalized config + per-provider states', async () => {
    const body = await (await GET(req('GET'))).json();
    expect(body.config).toMatchObject({ pickup: { enabled: true }, merchant: { enabled: true } });
    expect(body.providerStates.PICKUP).toBe('ENABLED');
    expect(body.providerStates.MERCHANT).toBe('ENABLED');
    // couriers have no env in tests → DISABLED (not enabled) or UNAVAILABLE
    expect(['DISABLED', 'CONFIGURED']).toContain(body.providerStates.DOORDASH);
  });
});

describe('PATCH /api/stores/fulfillment', () => {
  it('403s without CSRF', async () => {
    expect((await PATCH(req('PATCH', {}, 'missing'))).status).toBe(403);
  });

  it('persists a merged config and warns about an unconfigured enabled courier', async () => {
    const res = await PATCH(
      req('PATCH', { doordash: { enabled: true }, merchant: { feeCents: 799 } }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config.doordash.enabled).toBe(true);
    expect(body.config.merchant.feeCents).toBe(799);
    expect(body.warnings.some((w: { provider: string }) => w.provider === 'DOORDASH')).toBe(true);
    expect(prismaMock.store.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'store-1' } }),
    );
  });

  it('400s on a malformed body', async () => {
    const res = await PATCH(req('PATCH', { merchant: { feeCents: -1 } }));
    expect(res.status).toBe(400);
  });

  // Phase 3 — enabling a courier is Pro-only; toggling pickup/merchant is not.
  it('402 PLAN_UPGRADE_REQUIRED when a FREE store enables a courier', async () => {
    mockResolveOwnStore.mockResolvedValueOnce({ ...STORE, plan: 'FREE' } as never);
    const res = await PATCH(req('PATCH', { uberDirect: { enabled: true } }));
    expect(res.status).toBe(402);
    expect((await res.json()).feature).toBe('courierDelivery');
    expect(prismaMock.store.update).not.toHaveBeenCalled();
  });

  it('lets a FREE store still toggle pickup / merchant', async () => {
    mockResolveOwnStore.mockResolvedValueOnce({ ...STORE, plan: 'FREE' } as never);
    const res = await PATCH(req('PATCH', { merchant: { feeCents: 400 } }));
    expect(res.status).toBe(200);
  });

  it("only ever touches the caller's own store (no storeId from the body)", async () => {
    await PATCH(req('PATCH', { customerChoosesProvider: true, storeId: 'someone-else' }));
    expect(prismaMock.store.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'store-1' } }),
    );
  });
});
