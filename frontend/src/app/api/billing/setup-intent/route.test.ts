import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
vi.mock('@/lib/server/billing/stripe-billing', () => ({
  isBillingConfigured: vi.fn(() => true),
  getOrCreateBillingCustomer: vi.fn(async () => 'cus_1'),
  createCardSetupSession: vi.fn(async () => ({ url: 'https://checkout.stripe/setup' })),
  BillingUnconfiguredError: class BillingUnconfiguredError extends Error {},
}));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { isBillingConfigured, createCardSetupSession } from '@/lib/server/billing/stripe-billing';
import { POST } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockStore = vi.mocked(resolveOwnStore);
const mockConfigured = vi.mocked(isBillingConfigured);

const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/billing/setup-intent', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authedCtx as never);
  mockConfigured.mockReturnValue(true);
  mockStore.mockResolvedValue({ id: 'store-1' } as never);
});

describe('POST /api/billing/setup-intent', () => {
  it('403 without CSRF', async () => {
    expect((await POST(makePost('missing'))).status).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }) as never);
    expect((await POST(makePost())).status).toBe(401);
  });

  it('404 NO_STORE', async () => {
    mockStore.mockResolvedValueOnce(null);
    expect((await POST(makePost())).status).toBe(404);
  });

  it('503 when billing is not configured', async () => {
    mockConfigured.mockReturnValueOnce(false);
    const res = await POST(makePost());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('BILLING_NOT_CONFIGURED');
  });

  it('returns the setup Checkout url', async () => {
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://checkout.stripe/setup');
    expect(createCardSetupSession).toHaveBeenCalledWith({
      customerId: 'cus_1',
      storeId: 'store-1',
    });
  });
});
