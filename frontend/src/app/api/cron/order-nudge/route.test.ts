import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const nudgeUnfulfilledOrders = vi.fn();
vi.mock('@/lib/server/orders/nudge', () => ({
  nudgeUnfulfilledOrders: (...a: unknown[]) => nudgeUnfulfilledOrders(...a),
}));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  nudgeUnfulfilledOrders.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/cron/order-nudge', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('POST /api/cron/order-nudge', () => {
  it('401s when verifyCronSecret fails', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    expect(nudgeUnfulfilledOrders).not.toHaveBeenCalled();
  });

  it('runs the sweep and returns its counts', async () => {
    nudgeUnfulfilledOrders.mockResolvedValueOnce({ scanned: 4, nudged: 2 });
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, scanned: 4, nudged: 2 });
    expect(nudgeUnfulfilledOrders).toHaveBeenCalledOnce();
  });

  it('GET is aliased to the same handler', async () => {
    const mod = await import('./route');
    expect(mod.GET).toBe(mod.POST);
  });
});
