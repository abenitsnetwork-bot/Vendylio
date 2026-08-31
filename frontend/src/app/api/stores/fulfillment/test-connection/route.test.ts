import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
const testConnection = vi.fn();
vi.mock('@/lib/server/fulfillment/registry', () => ({
  getDeliveryProvider: vi.fn(() => ({ testConnection })),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { getDeliveryProvider } from '@/lib/server/fulfillment/registry';
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ user: { sub: 'u1', email: 'a@b.c' } } as never);
  vi.mocked(resolveOwnStore).mockResolvedValue({ id: 'store-1' } as never);
  testConnection.mockResolvedValue({ ok: true, detail: 'Authenticated.' });
});

function req(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'tok';
  return new NextRequest('http://test/api/stores/fulfillment/test-connection', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/stores/fulfillment/test-connection', () => {
  it('403s without CSRF', async () => {
    expect((await POST(req({ provider: 'DOORDASH' }, 'missing'))).status).toBe(403);
  });

  it('401s when unauthenticated', async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(
      NextResponse.json({ error: 'x' }, { status: 401 }) as never,
    );
    expect((await POST(req({ provider: 'DOORDASH' }))).status).toBe(401);
  });

  it('400s for a non-courier provider', async () => {
    expect((await POST(req({ provider: 'MERCHANT' }))).status).toBe(400);
  });

  it('delegates to the adapter testConnection and returns its result', async () => {
    const res = await POST(req({ provider: 'UBER_DIRECT' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, detail: 'Authenticated.' });
    expect(getDeliveryProvider).toHaveBeenCalledWith('UBER_DIRECT');
    expect(testConnection).toHaveBeenCalled();
  });
});
