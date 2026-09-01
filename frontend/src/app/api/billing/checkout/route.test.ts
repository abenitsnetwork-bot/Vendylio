import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
vi.mock('@/lib/server/billing/stripe-billing', () => ({
  isBillingConfigured: vi.fn(() => true),
  getOrCreateBillingCustomer: vi.fn(async () => 'cus_1'),
  createProCheckoutSession: vi.fn(async () => ({ url: 'https://checkout.stripe/x' })),
  BillingUnconfiguredError: class BillingUnconfiguredError extends Error {},
}));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { isBillingConfigured, createProCheckoutSession } from '@/lib/server/billing/stripe-billing';
import { POST } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockStore = vi.mocked(resolveOwnStore);
const mockConfigured = vi.mocked(isBillingConfigured);

const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/billing/checkout', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authedCtx);
  mockConfigured.mockReturnValue(true);
});

describe('POST /api/billing/checkout', () => {
  it('403 without CSRF', async () => {
    expect((await POST(makePost('missing'))).status).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await POST(makePost())).status).toBe(401);
  });

  it('404 NO_STORE when the caller has no store', async () => {
    mockStore.mockResolvedValueOnce(null);
    const res = await POST(makePost());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NO_STORE');
  });

  it('503 when billing is not configured', async () => {
    mockStore.mockResolvedValueOnce({ id: 'store-1', subscriptionStatus: null } as never);
    mockConfigured.mockReturnValueOnce(false);
    const res = await POST(makePost());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('BILLING_NOT_CONFIGURED');
  });

  it('409 ALREADY_SUBSCRIBED when the store already has an active sub', async () => {
    mockStore.mockResolvedValueOnce({ id: 'store-1', subscriptionStatus: 'ACTIVE' } as never);
    const res = await POST(makePost());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('ALREADY_SUBSCRIBED');
  });

  it('returns the Checkout url on success', async () => {
    mockStore.mockResolvedValueOnce({ id: 'store-1', subscriptionStatus: null } as never);
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://checkout.stripe/x');
    expect(createProCheckoutSession).toHaveBeenCalledWith({
      customerId: 'cus_1',
      storeId: 'store-1',
    });
  });

  it("source keeps runtime='nodejs' + withRequestContext + verifyCsrf", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
    expect(src).toContain('verifyCsrf');
  });
});
