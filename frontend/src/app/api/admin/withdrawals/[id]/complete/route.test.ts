// Mirrors ../cancel/route.test.ts's structure for the other terminal
// outcome — the operator manually sent the seller their payout and is
// closing out the request.
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedSuperadmin, seedWithdrawal } from '@/test-utils/admin-fixtures';

const { lockSpy } = vi.hoisted(() => ({ lockSpy: vi.fn() }));
vi.mock('@/lib/server/withdrawals/lock', () => ({
  lockUserTx: lockSpy,
}));
vi.mock('@/lib/server/middleware', () => ({
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { POST } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actor = seedSuperadmin({ id: 'superadmin_actor' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeReq(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/withdrawals/w1/complete', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function ctxWith(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (cb, _opts) =>
    (cb as (tx: typeof prismaMock) => unknown)(prismaMock),
  );
});

describe('POST /api/admin/withdrawals/[id]/complete', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makeReq({}, 'missing'), ctxWith('w1'));
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin (ADMIN cannot complete)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await POST(makeReq({}), ctxWith('w1'));
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await POST(makeReq({}), ctxWith('w1'));
    expect(res.status).toBe(429);
  });

  it('404s WITHDRAWAL_NOT_FOUND when the owner lookup misses (before the lock) — proves an empty body is accepted', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValueOnce(null as never);
    const res = await POST(makeReq({}), ctxWith('missing'));
    expect(res.status).toBe(404);
    expect(lockSpy).not.toHaveBeenCalled();
  });

  it('acquires the advisory lock on the WITHDRAWAL OWNER (not the admin actor) as the first tx statement', async () => {
    const w = seedWithdrawal({ id: 'w1', userId: 'seller_owner', status: 'PENDING' });
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce({ userId: 'seller_owner' } as never)
      .mockResolvedValueOnce(w as never);
    prismaMock.withdrawal.update.mockResolvedValueOnce({ ...w, status: 'COMPLETED' } as never);

    await POST(makeReq({}), ctxWith('w1'));

    expect(lockSpy).toHaveBeenCalledWith(prismaMock, 'seller_owner');
    expect(prismaMock.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('404s WITHDRAWAL_NOT_FOUND when the row disappears between the two lookups', async () => {
    prismaMock.withdrawal.findUnique
      .mockResolvedValueOnce({ userId: 'seller_owner' } as never)
      .mockResolvedValueOnce(null as never);

    const res = await POST(makeReq({}), ctxWith('w1'));
    expect(res.status).toBe(404);
    expect(prismaMock.withdrawal.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as const)(
    '409s WITHDRAWAL_NOT_COMPLETABLE when status is %s',
    async (status) => {
      const w = seedWithdrawal({ id: 'w1', userId: 'seller_owner', status });
      prismaMock.withdrawal.findUnique
        .mockResolvedValueOnce({ userId: 'seller_owner' } as never)
        .mockResolvedValueOnce(w as never);

      const res = await POST(makeReq({}), ctxWith('w1'));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('WITHDRAWAL_NOT_COMPLETABLE');
      expect(prismaMock.withdrawal.update).not.toHaveBeenCalled();
    },
  );

  it.each(['PENDING', 'PROCESSING'] as const)(
    'completes a %s withdrawal and logs the action',
    async (status) => {
      const w = seedWithdrawal({ id: 'w1', userId: 'seller_owner', status, amount: 4200 });
      prismaMock.withdrawal.findUnique
        .mockResolvedValueOnce({ userId: 'seller_owner' } as never)
        .mockResolvedValueOnce(w as never);
      prismaMock.withdrawal.update.mockResolvedValueOnce({
        ...w,
        status: 'COMPLETED',
      } as never);

      const res = await POST(makeReq({ note: 'Sent via Cash App' }), ctxWith('w1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.withdrawal.status).toBe('COMPLETED');

      const updateArg = prismaMock.withdrawal.update.mock.calls[0]?.[0];
      expect(updateArg?.where).toEqual({ id: 'w1' });
      expect(updateArg?.data).toMatchObject({ status: 'COMPLETED' });

      expect(mockLogAdminAction).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          actorId: actor.id,
          action: 'withdrawal.complete',
          targetType: 'Withdrawal',
          targetId: 'w1',
          metadata: expect.objectContaining({
            withdrawalId: 'w1',
            amount: 4200,
            previousStatus: status,
            note: 'Sent via Cash App',
          }),
        }),
      );
    },
  );
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
