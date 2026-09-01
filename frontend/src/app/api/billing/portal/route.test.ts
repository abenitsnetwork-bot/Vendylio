import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
vi.mock('@/lib/server/billing/stripe-billing', () => ({
  createPortalSession: vi.fn(async () => ({ url: 'https://portal.stripe/x' })),
  BillingUnconfiguredError: class BillingUnconfiguredError extends Error {},
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { POST } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/billing/portal', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authedCtx);
});

describe('POST /api/billing/portal', () => {
  it('403 without CSRF', async () => {
    expect((await POST(makePost('missing'))).status).toBe(403);
  });

  it('404 when the caller has no store', async () => {
    mockStore.mockResolvedValueOnce(null);
    expect((await POST(makePost())).status).toBe(404);
  });

  it('400 NO_BILLING_CUSTOMER when the store never subscribed', async () => {
    mockStore.mockResolvedValueOnce({ id: 'store-1', stripeCustomerId: null } as never);
    const res = await POST(makePost());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('NO_BILLING_CUSTOMER');
  });

  it('returns the portal url when a customer exists', async () => {
    mockStore.mockResolvedValueOnce({ id: 'store-1', stripeCustomerId: 'cus_1' } as never);
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://portal.stripe/x');
  });
});
