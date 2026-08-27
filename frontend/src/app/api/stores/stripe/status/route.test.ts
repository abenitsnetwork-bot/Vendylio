import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));
vi.mock('@/lib/server/payments/stripe-connect', () => ({
  retrieveAccountCapabilities: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { retrieveAccountCapabilities } from '@/lib/server/payments/stripe-connect';
import { GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const mockRetrieveCaps = vi.mocked(retrieveAccountCapabilities);

const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/stores/stripe/status', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('GET /api/stores/stripe/status', () => {
  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('404s NO_STORE when the caller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
  });

  it('returns the stored status as-is when there is no connected account yet', async () => {
    mockResolveOwnStore.mockResolvedValue({
      id: 'store-1',
      stripeAccountId: null,
      stripeOnboardingStatus: 'NOT_STARTED',
    } as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body).toEqual({ stripeOnboardingStatus: 'NOT_STARTED', connected: false });
    expect(mockRetrieveCaps).not.toHaveBeenCalled();
  });

  it('opportunistically syncs to ACTIVE when Stripe reports both capabilities enabled', async () => {
    mockResolveOwnStore.mockResolvedValue({
      id: 'store-1',
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'PENDING',
    } as never);
    mockRetrieveCaps.mockResolvedValue({ chargesEnabled: true, payoutsEnabled: true });

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body).toEqual({ stripeOnboardingStatus: 'ACTIVE', connected: true });
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { stripeOnboardingStatus: 'ACTIVE' },
    });
  });

  it('leaves the status untouched when Stripe still reports capabilities disabled', async () => {
    mockResolveOwnStore.mockResolvedValue({
      id: 'store-1',
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'PENDING',
    } as never);
    mockRetrieveCaps.mockResolvedValue({ chargesEnabled: false, payoutsEnabled: false });

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.stripeOnboardingStatus).toBe('PENDING');
    expect(prismaMock.store.update).not.toHaveBeenCalled();
  });

  it('does not ACTIVE-check again once already ACTIVE (skips the Stripe call)', async () => {
    mockResolveOwnStore.mockResolvedValue({
      id: 'store-1',
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'ACTIVE',
    } as never);

    const res = await GET(makeGet());
    const body = await res.json();
    expect(body.stripeOnboardingStatus).toBe('ACTIVE');
    expect(mockRetrieveCaps).not.toHaveBeenCalled();
  });

  it('falls back to the stored status when Stripe is unreachable', async () => {
    mockResolveOwnStore.mockResolvedValue({
      id: 'store-1',
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'PENDING',
    } as never);
    mockRetrieveCaps.mockRejectedValue(new Error('network error'));

    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stripeOnboardingStatus).toBe('PENDING');
  });
});
