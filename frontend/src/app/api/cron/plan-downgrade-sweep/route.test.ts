import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const sweepExpiredPlans = vi.fn();
vi.mock('@/lib/server/billing/downgrade', () => ({
  sweepExpiredPlans: (...a: unknown[]) => sweepExpiredPlans(...a),
}));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  sweepExpiredPlans.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/cron/plan-downgrade-sweep', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('POST /api/cron/plan-downgrade-sweep', () => {
  it('401s when verifyCronSecret fails', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    expect((await POST(makeReq())).status).toBe(401);
    expect(sweepExpiredPlans).not.toHaveBeenCalled();
  });

  it('runs the sweep and returns its counts', async () => {
    sweepExpiredPlans.mockResolvedValueOnce({ compExpired: 1, subscriptionLapsed: 0 });
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, compExpired: 1, subscriptionLapsed: 0 });
  });

  it('GET is aliased to the same handler', async () => {
    const mod = await import('./route');
    expect(mod.GET).toBe(mod.POST);
  });
});
