// Phase 2 — SUPERADMIN fires a Stripe Connect transfer for a BANK withdrawal.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedSuperadmin } from '@/test-utils/admin-fixtures';

const { lockSpy } = vi.hoisted(() => ({ lockSpy: vi.fn() }));
vi.mock('@/lib/server/withdrawals/lock', () => ({ lockUserTx: lockSpy }));
vi.mock('@/lib/server/middleware', () => ({ requireSuperadmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));
// `after()` throws outside a real request scope — run its callback inline.
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return { ...actual, after: (fn: () => unknown) => void fn() };
});
vi.mock('@/lib/server/statements/generate', () => ({
  generateStatementForWithdrawal: vi.fn(),
}));

const createConnectTransfer = vi.fn();
vi.mock('@/lib/server/payments/stripe-connect', () => ({
  createConnectTransfer: (...a: unknown[]) => createConnectTransfer(...(a as [])),
  StripeConnectUnconfiguredError: class StripeConnectUnconfiguredError extends Error {},
}));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { resolveOwnStore } from '@/lib/server/org';
import { POST } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLog = vi.mocked(logAdminAction);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);

const actor = seedSuperadmin({ id: 'superadmin_actor' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeReq(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/withdrawals/w1/send-transfer', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

function ctxWith(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const BANK_WD = {
  userId: 'seller_owner',
  status: 'PENDING',
  provider: 'stripe_transfer',
  amount: 5000,
  commissionSettledCents: 300,
  currency: 'USD',
};
const ACTIVE_STORE = { stripeAccountId: 'acct_1', stripeOnboardingStatus: 'ACTIVE' };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
  mockResolveOwnStore.mockResolvedValue(ACTIVE_STORE as never);
  createConnectTransfer.mockResolvedValue({ transferId: 'tr_123' });
  prismaMock.$transaction.mockImplementation(async (cb, _opts) =>
    (cb as (tx: typeof prismaMock) => unknown)(prismaMock),
  );
});

describe('POST /api/admin/withdrawals/[id]/send-transfer', () => {
  it('403 without CSRF', async () => {
    expect((await POST(makeReq('missing'), ctxWith('w1'))).status).toBe(403);
  });

  it('403 for a non-superadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 403 }));
    expect((await POST(makeReq(), ctxWith('w1'))).status).toBe(403);
  });

  it('404 when the withdrawal is missing', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValueOnce(null as never);
    expect((await POST(makeReq(), ctxWith('w1'))).status).toBe(404);
  });

  it('409 NOT_A_BANK_WITHDRAWAL for a manual (Cash App) withdrawal', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValueOnce({
      ...BANK_WD,
      provider: 'manual',
    } as never);
    const res = await POST(makeReq(), ctxWith('w1'));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('NOT_A_BANK_WITHDRAWAL');
  });

  it('409 when the withdrawal is not PENDING', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValueOnce({
      ...BANK_WD,
      status: 'COMPLETED',
    } as never);
    expect((await POST(makeReq(), ctxWith('w1'))).status).toBe(409);
  });

  it('422 when the seller Connect account is not ACTIVE', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValueOnce(BANK_WD as never);
    mockResolveOwnStore.mockResolvedValueOnce({
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'PENDING',
    } as never);
    const res = await POST(makeReq(), ctxWith('w1'));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('CONNECT_ACCOUNT_UNAVAILABLE');
  });

  it('transfers the NET (amount − commission), marks COMPLETED, records tr_id + audits', async () => {
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce(BANK_WD as never) // top-level
      .mockResolvedValueOnce({ status: 'PENDING' } as never); // tx1 re-check
    prismaMock.withdrawal.update
      .mockResolvedValueOnce({ id: 'w1', status: 'PROCESSING' } as never) // tx1
      .mockResolvedValueOnce({ id: 'w1', status: 'COMPLETED' } as never); // tx2

    const res = await POST(makeReq(), ctxWith('w1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transferId).toBe('tr_123');

    expect(createConnectTransfer).toHaveBeenCalledWith({
      destinationAccountId: 'acct_1',
      amountCents: 4700, // 5000 − 300
      currency: 'USD',
      withdrawalId: 'w1',
    });
    expect(lockSpy).toHaveBeenCalledWith(prismaMock, 'seller_owner');
    const finalUpdate = prismaMock.withdrawal.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate?.data).toMatchObject({
      status: 'COMPLETED',
      providerPayoutId: 'tr_123',
    });
    expect(mockLog).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ action: 'withdrawal.send_transfer', targetId: 'w1' }),
    );
  });

  it('on Stripe failure: reverts to FAILED and returns 502', async () => {
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce(BANK_WD as never)
      .mockResolvedValueOnce({ status: 'PENDING' } as never);
    prismaMock.withdrawal.update.mockResolvedValue({ id: 'w1' } as never);
    createConnectTransfer.mockRejectedValueOnce(new Error('insufficient funds'));

    const res = await POST(makeReq(), ctxWith('w1'));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('TRANSFER_FAILED');

    const failUpdate = prismaMock.withdrawal.update.mock.calls.at(-1)?.[0];
    expect(failUpdate?.data).toMatchObject({ status: 'FAILED' });
    expect(mockLog).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({ action: 'withdrawal.send_transfer_failed' }),
    );
  });

  it('409 when the row is no longer PENDING at claim time (race)', async () => {
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce(BANK_WD as never)
      .mockResolvedValueOnce({ status: 'PROCESSING' } as never); // someone else claimed it
    const res = await POST(makeReq(), ctxWith('w1'));
    expect(res.status).toBe(409);
    expect(createConnectTransfer).not.toHaveBeenCalled();
  });
});
