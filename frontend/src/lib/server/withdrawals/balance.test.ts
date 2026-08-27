import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { resolveOwnStore } from '@/lib/server/org';
import { createDefaultBalanceComputer } from './balance';

const mockResolveOwnStore = vi.mocked(resolveOwnStore);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createDefaultBalanceComputer', () => {
  it('sums PAID Orders by the caller Store, not by Order.userId (Phase 2 fix)', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.order.findMany.mockResolvedValue([
      { amount: 1000, netAmount: 940 },
      { amount: 500, netAmount: null },
    ] as never);
    prismaMock.withdrawal.findMany.mockResolvedValue([{ amount: 300 }] as never);

    const computeBalance = createDefaultBalanceComputer(prismaMock as never);
    const balance = await computeBalance('seller-1');

    expect(balance).toBe(940 + 500 - 300);
    const orderArgs = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(orderArgs?.where).toEqual({
      storeId: 'store-1',
      status: { in: ['PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
      provider: 'stripe_platform',
    });
    const withdrawalArgs = prismaMock.withdrawal.findMany.mock.calls[0]?.[0];
    expect(withdrawalArgs?.where).toMatchObject({ userId: 'seller-1' });
  });

  // Phase 3 security requirement — a Store connected to Stripe Connect gets
  // paid directly by Stripe on `stripe_connect` orders; those must never
  // also count toward the manual-withdrawal balance (double-spend guard).
  it('excludes stripe_connect orders from the balance (Phase 3 security filter)', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.order.findMany.mockResolvedValue([{ amount: 1000, netAmount: 940 }] as never);
    prismaMock.withdrawal.findMany.mockResolvedValue([]);

    const computeBalance = createDefaultBalanceComputer(prismaMock as never);
    await computeBalance('seller-1');

    const orderArgs = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(orderArgs?.where).toMatchObject({ provider: 'stripe_platform' });
    // The mock always returns whatever is stubbed regardless of the where
    // clause, so this test only proves the *filter is requested* — the
    // real Prisma query engine is what actually excludes stripe_connect
    // rows at read time.
  });

  it('still counts an order toward the balance after it progresses past PAID to DELIVERED', async () => {
    // Regression: an exact `status: 'PAID'` match made a seller's earnings
    // vanish from their withdrawable balance the moment an order advanced
    // past its first post-payment status.
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.order.findMany.mockResolvedValue([{ amount: 1000, netAmount: 940 }] as never);
    prismaMock.withdrawal.findMany.mockResolvedValue([]);

    const computeBalance = createDefaultBalanceComputer(prismaMock as never);
    const balance = await computeBalance('seller-1');

    expect(balance).toBe(940);
    const orderArgs = prismaMock.order.findMany.mock.calls[0]?.[0];
    const statusFilter = (orderArgs?.where as { status?: { in?: string[] } } | undefined)?.status;
    expect(statusFilter?.in).toContain('DELIVERED');
    expect(statusFilter?.in).not.toContain('REFUNDED');
    expect(statusFilter?.in).not.toContain('CANCELLED');
  });

  it('returns 0 (not an error) when the caller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    prismaMock.withdrawal.findMany.mockResolvedValue([]);

    const computeBalance = createDefaultBalanceComputer(prismaMock as never);
    const balance = await computeBalance('no-store-user');

    expect(balance).toBe(0);
    expect(prismaMock.order.findMany).not.toHaveBeenCalled();
  });

  it('never returns a negative balance even if withdrawals exceed earnings', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.order.findMany.mockResolvedValue([{ amount: 100, netAmount: 100 }] as never);
    prismaMock.withdrawal.findMany.mockResolvedValue([{ amount: 9999 }] as never);

    const computeBalance = createDefaultBalanceComputer(prismaMock as never);
    const balance = await computeBalance('seller-1');

    expect(balance).toBe(0);
  });
});
