import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/cron/auth', () => ({ verifyCronSecret: vi.fn(() => null) }));
vi.mock('@/lib/server/leader-lease', () => ({
  withLease: vi.fn(async (_r: unknown, _n: string, _t: number, fn: () => Promise<void>) => fn()),
}));
vi.mock('@/lib/server/redis', () => ({ redis: null }));

const runReconciliationMock = vi.fn();
vi.mock('@/lib/server/payments/reconciliation', () => ({
  runReconciliation: runReconciliationMock,
}));

vi.mock('@/lib/server/prisma', () => ({ prisma: {} }));

const EMPTY_SUMMARY = {
  eligibleOrders: 0,
  checkedOrders: 0,
  paidDiscrepancies: 0,
  alreadyRecorded: 0,
  stripeErrors: 0,
  notFound: 0,
  skipped: 0,
};

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  runReconciliationMock.mockReset().mockResolvedValue(EMPTY_SUMMARY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function makeReq(): NextRequest {
  return new NextRequest('http://localhost/api/cron/stripe-payment-reconciliation', {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('POST /api/cron/stripe-payment-reconciliation', () => {
  it('returns 401 when verifyCronSecret fails', async () => {
    const { verifyCronSecret } = await import('@/lib/server/cron/auth');
    (verifyCronSecret as Mock).mockReturnValueOnce(
      NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 }),
    );
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it('calls runReconciliation with prisma', async () => {
    const { POST } = await import('./route');
    await POST(makeReq());
    expect(runReconciliationMock).toHaveBeenCalledWith(expect.anything());
  });

  it('returns the aggregate summary from the service', async () => {
    runReconciliationMock.mockResolvedValueOnce({
      eligibleOrders: 3,
      checkedOrders: 3,
      paidDiscrepancies: 1,
      alreadyRecorded: 0,
      stripeErrors: 0,
      notFound: 1,
      skipped: 0,
    });
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      eligibleOrders: 3,
      checkedOrders: 3,
      paidDiscrepancies: 1,
      alreadyRecorded: 0,
      stripeErrors: 0,
      notFound: 1,
      skipped: 0,
    });
  });

  it('completes successfully even when there are no eligible orders', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...EMPTY_SUMMARY });
  });

  it('exports runtime=nodejs and dynamic=force-dynamic', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('aliases GET to POST (Vercel Cron invokes with GET)', async () => {
    const mod = await import('./route');
    expect(mod.GET).toBe(mod.POST);
  });
});
