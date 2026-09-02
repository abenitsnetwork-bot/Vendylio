import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { seedAdmin } from '@/test-utils/admin-fixtures';
import { GET } from './route';

const mockRequireAdmin = vi.mocked(requireAdmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const admin = seedAdmin({ id: 'admin_1', email: 'a@test.local' });
const adminCtx = {
  user: { sub: admin.id, email: admin.email },
  admin: { id: admin.id, email: admin.email, role: 'ADMIN' as const },
};

const get = () => GET(new NextRequest('http://test/api/admin/withdrawals/pending-summary'));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(adminCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('GET /api/admin/withdrawals/pending-summary', () => {
  it('403s a non-admin', async () => {
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 }) as never,
    );
    expect((await get()).status).toBe(403);
  });

  it('returns queue counts + recent rows with resolved store names and net amount', async () => {
    prismaMock.withdrawal.count
      .mockResolvedValueOnce(3 as never) // PENDING
      .mockResolvedValueOnce(1 as never); // PROCESSING
    prismaMock.withdrawal.findMany.mockResolvedValue([
      {
        id: 'w1',
        userId: 'u1',
        amount: 8500,
        commissionSettledCents: 350,
        currency: 'USD',
        status: 'PENDING',
        destination: { method: 'CASH_APP', cashtag: '$shop' },
        provider: 'manual',
        requestedAt: new Date('2026-03-01T10:00:00Z'),
      },
      {
        id: 'w2',
        userId: 'u2',
        amount: 2000,
        commissionSettledCents: 0,
        currency: 'USD',
        status: 'PROCESSING',
        destination: { method: 'BANK' },
        provider: 'stripe_transfer',
        requestedAt: new Date('2026-02-28T10:00:00Z'),
      },
    ] as never);
    prismaMock.organizationMember.findMany.mockResolvedValue([
      { userId: 'u1', organization: { store: { name: 'Ako Market', slug: 'ako' } } },
      { userId: 'u2', organization: { store: null } },
    ] as never);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pendingCount).toBe(3);
    expect(body.processingCount).toBe(1);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      id: 'w1',
      storeName: 'Ako Market',
      storeSlug: 'ako',
      amountCents: 8500,
      netCents: 8150,
      method: 'Cash App $shop',
      status: 'PENDING',
    });
    expect(body.items[1]).toMatchObject({
      storeName: '(no store)',
      method: 'Bank (ACH)',
      netCents: 2000,
    });

    const whereIn = prismaMock.withdrawal.findMany.mock.calls[0]?.[0]?.where;
    expect(whereIn).toEqual({ status: { in: ['PENDING', 'PROCESSING'] } });
  });

  it('skips the membership query when there are no recent rows', async () => {
    prismaMock.withdrawal.count.mockResolvedValue(0 as never);
    prismaMock.withdrawal.findMany.mockResolvedValue([] as never);

    const body = await (await get()).json();
    expect(body).toEqual({ pendingCount: 0, processingCount: 0, items: [] });
    expect(prismaMock.organizationMember.findMany).not.toHaveBeenCalled();
  });
});
