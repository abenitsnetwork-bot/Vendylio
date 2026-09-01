import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireSuperadmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({ enforceAdminRateLimit: vi.fn() }));
vi.mock('@/lib/server/admin/audit', () => ({ logAdminAction: vi.fn() }));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { PATCH } from './route';

const mockSuper = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLog = vi.mocked(logAdminAction);

const superCtx = {
  user: { sub: 'sa_1', email: 'sa@test.local' },
  admin: { id: 'sa_1', email: 'sa@test.local', role: 'SUPERADMIN' as const },
};

function req(body?: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/stores/s1/plan', {
    method: 'PATCH',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const ctx = { params: Promise.resolve({ id: 's1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockSuper.mockResolvedValue(superCtx);
  mockRateLimit.mockResolvedValue(undefined as never);
});

describe('PATCH /api/admin/stores/[id]/plan', () => {
  it('403 without CSRF', async () => {
    expect((await PATCH(req({ plan: 'PRO' }, 'missing'), ctx)).status).toBe(403);
  });

  it('403 for a non-superadmin', async () => {
    mockSuper.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 403 }));
    expect((await PATCH(req({ plan: 'PRO' }), ctx)).status).toBe(403);
  });

  it('400 on an invalid plan value', async () => {
    expect((await PATCH(req({ plan: 'GOLD' }), ctx)).status).toBe(400);
  });

  it('404 when the store does not exist', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce(null);
    expect((await PATCH(req({ plan: 'PRO' }), ctx)).status).toBe(404);
  });

  it('409 when the store pays via Stripe (planSource SUBSCRIPTION)', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      id: 's1',
      plan: 'PRO',
      planSource: 'SUBSCRIPTION',
      subscriptionStatus: 'ACTIVE',
    } as never);
    const res = await PATCH(req({ plan: 'FREE' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('STRIPE_MANAGED_PLAN');
  });

  it('comps PRO with planSource COMP + an expiry, and audits it', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      id: 's1',
      plan: 'FREE',
      planSource: null,
      subscriptionStatus: null,
    } as never);
    prismaMock.store.update.mockResolvedValueOnce({
      id: 's1',
      plan: 'PRO',
      planSource: 'COMP',
      planCompExpiresAt: new Date('2026-12-01T00:00:00Z'),
    } as never);

    const res = await PATCH(req({ plan: 'PRO', compDays: 30 }), ctx);
    expect(res.status).toBe(200);
    const updateArg = prismaMock.store.update.mock.calls.at(0)![0];
    expect(updateArg.data.plan).toBe('PRO');
    expect(updateArg.data.planSource).toBe('COMP');
    expect(updateArg.data.planCompExpiresAt).toBeInstanceOf(Date);
    expect(mockLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'store.plan.comp', targetId: 's1' }),
    );
  });

  it('FREE→FREE is an idempotent no-op (no write, no audit)', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      id: 's1',
      plan: 'FREE',
      planSource: null,
      subscriptionStatus: null,
    } as never);
    const res = await PATCH(req({ plan: 'FREE' }), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.store.update).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('clears a comp on plan=FREE', async () => {
    prismaMock.store.findUnique.mockResolvedValueOnce({
      id: 's1',
      plan: 'PRO',
      planSource: 'COMP',
      subscriptionStatus: null,
    } as never);
    prismaMock.store.update.mockResolvedValueOnce({
      id: 's1',
      plan: 'FREE',
      planSource: null,
      planCompExpiresAt: null,
    } as never);
    await PATCH(req({ plan: 'FREE' }), ctx);
    const updateArg = prismaMock.store.update.mock.calls.at(0)![0];
    expect(updateArg.data).toEqual({ plan: 'FREE', planSource: null, planCompExpiresAt: null });
  });
});
