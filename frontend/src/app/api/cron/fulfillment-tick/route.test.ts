import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));
vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

const runFulfillmentTick = vi.fn();
vi.mock('@/lib/server/fulfillment/dispatch', () => ({ runFulfillmentTick }));

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  runFulfillmentTick.mockResolvedValue({
    dispatched: 2,
    dispatchFailed: 0,
    polled: 5,
    pollAdvanced: 1,
    quotesPurged: 9,
    staleDispatch: 1,
    staleUnassigned: 0,
    staleInTransit: 2,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/cron/fulfillment-tick', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('POST /api/cron/fulfillment-tick', () => {
  it('401s when verifyCronSecret fails', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    expect((await POST(makeReq())).status).toBe(401);
    expect(runFulfillmentTick).not.toHaveBeenCalled();
  });

  it('runs the tick inside a lease and returns the summary', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      dispatched: 2,
      quotesPurged: 9,
      staleDispatch: 1,
      staleInTransit: 2,
    });
    const { withLease } = await import('@/lib/server/leader-lease');
    expect((withLease as Mock).mock.calls[0]![1]).toBe('fulfillment-tick');
  });

  it('exports GET as an alias of POST', async () => {
    const mod = await import('./route');
    expect(mod.GET).toBe(mod.POST);
  });
});
