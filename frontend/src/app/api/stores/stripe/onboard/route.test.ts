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
  createExpressAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  StripeConnectUnconfiguredError: class StripeConnectUnconfiguredError extends Error {
    constructor() {
      super('Stripe Connect not configured');
      this.name = 'StripeConnectUnconfiguredError';
    }
  },
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import {
  createExpressAccount,
  createOnboardingLink,
  StripeConnectUnconfiguredError,
} from '@/lib/server/payments/stripe-connect';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const mockCreateExpressAccount = vi.mocked(createExpressAccount);
const mockCreateOnboardingLink = vi.mocked(createOnboardingLink);

const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/stores/stripe/onboard', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockCreateOnboardingLink.mockResolvedValue('https://connect.stripe.com/setup/acct_1');
});

describe('POST /api/stores/stripe/onboard', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost('missing'));
    expect(res.status).toBe(403);
    expect(mockResolveOwnStore).not.toHaveBeenCalled();
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost());
    expect(res.status).toBe(401);
  });

  it('404s NO_STORE when the caller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await POST(makePost());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('creates a new Express account when the store has none yet, then returns an onboarding URL', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', stripeAccountId: null } as never);
    mockCreateExpressAccount.mockResolvedValue('acct_new_1');

    const res = await POST(makePost());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe('https://connect.stripe.com/setup/acct_1');
    expect(mockCreateExpressAccount).toHaveBeenCalledWith('seller@example.com');
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { stripeAccountId: 'acct_new_1', stripeOnboardingStatus: 'PENDING' },
    });
    expect(mockCreateOnboardingLink).toHaveBeenCalledWith(
      'acct_new_1',
      expect.any(String),
      expect.any(String),
    );
  });

  it('reuses an existing stripeAccountId instead of creating a second account', async () => {
    mockResolveOwnStore.mockResolvedValue({
      id: 'store-1',
      stripeAccountId: 'acct_existing',
    } as never);

    const res = await POST(makePost());

    expect(res.status).toBe(200);
    expect(mockCreateExpressAccount).not.toHaveBeenCalled();
    expect(prismaMock.store.update).not.toHaveBeenCalled();
    expect(mockCreateOnboardingLink).toHaveBeenCalledWith(
      'acct_existing',
      expect.any(String),
      expect.any(String),
    );
  });

  it('503s PAYMENT_PROVIDER_UNCONFIGURED when Stripe env is missing', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', stripeAccountId: null } as never);
    mockCreateExpressAccount.mockRejectedValue(new StripeConnectUnconfiguredError());

    const res = await POST(makePost());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNCONFIGURED');
  });

  it('502s STRIPE_CONNECT_FAILED when Stripe itself errors', async () => {
    mockResolveOwnStore.mockResolvedValue({
      id: 'store-1',
      stripeAccountId: 'acct_existing',
    } as never);
    mockCreateOnboardingLink.mockRejectedValue(new Error('rate limited'));

    const res = await POST(makePost());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('STRIPE_CONNECT_FAILED');
  });
});
