import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
vi.mock('@/lib/server/billing/stripe-billing', () => ({
  isBillingConfigured: vi.fn(() => true),
  annualBillingAvailable: vi.fn(() => false),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { GET } from './route';

const mockAuth = vi.mocked(requireAuth);
const mockStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

const req = new NextRequest('http://test/api/billing/status');

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/billing/status', () => {
  it('401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await GET(req)).status).toBe(401);
  });

  it('404 when the caller has no store', async () => {
    mockStore.mockResolvedValueOnce(null);
    expect((await GET(req)).status).toBe(404);
  });

  it('reports FREE with a feature set and no subscription', async () => {
    mockStore.mockResolvedValueOnce({
      plan: 'FREE',
      planSource: null,
      subscriptionStatus: null,
      subscriptionCurrentPeriodEnd: null,
      planCompExpiresAt: null,
      stripeCustomerId: null,
    } as never);
    const body = await (await GET(req)).json();
    expect(body.plan).toBe('FREE');
    expect(body.subscriptionStatus).toBeNull();
    expect(body.features.promoCodes).toBe(false);
    expect(body.hasBillingCustomer).toBe(false);
  });

  it('reports PRO + ISO dates for a subscribed store', async () => {
    const end = new Date('2026-12-01T00:00:00Z');
    mockStore.mockResolvedValueOnce({
      plan: 'PRO',
      planSource: 'SUBSCRIPTION',
      subscriptionStatus: 'ACTIVE',
      subscriptionCurrentPeriodEnd: end,
      planCompExpiresAt: null,
      stripeCustomerId: 'cus_1',
    } as never);
    const body = await (await GET(req)).json();
    expect(body.plan).toBe('PRO');
    expect(body.currentPeriodEnd).toBe(end.toISOString());
    expect(body.features.promoCodes).toBe(true);
  });
});
