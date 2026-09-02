import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { resolveOwnStore } from '@/lib/server/org';
import { buildStatementForWithdrawal } from './build';

const mockResolveOwnStore = vi.mocked(resolveOwnStore);

const STORE = {
  id: 'store-1',
  name: 'Ako International Market',
  slug: 'ako-international-market',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveOwnStore.mockResolvedValue(STORE as never);
});

function baseWithdrawal(over: Record<string, unknown> = {}) {
  return {
    id: 'wd-1',
    userId: 'seller-1',
    amount: 8500,
    commissionSettledCents: 350,
    currency: 'USD',
    status: 'COMPLETED',
    destination: { method: 'CASH_APP', cashtag: '$cashdo21' },
    requestedAt: new Date('2026-03-01T10:00:00Z'),
    completedAt: new Date('2026-03-02T12:00:00Z'),
    ...over,
  };
}

describe('buildStatementForWithdrawal', () => {
  it('returns null when the withdrawal is not COMPLETED', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValue(
      baseWithdrawal({ status: 'PENDING' }) as never,
    );
    expect(await buildStatementForWithdrawal(prismaMock as never, 'wd-1')).toBeNull();
  });

  it('returns null when no store resolves', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValue(baseWithdrawal() as never);
    mockResolveOwnStore.mockResolvedValue(null);
    expect(await buildStatementForWithdrawal(prismaMock as never, 'wd-1')).toBeNull();
  });

  it('groups sales by payment method, itemises withheld commission, nets the payout', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValue(baseWithdrawal() as never);
    // no previous statement → period starts at store.createdAt
    prismaMock.withdrawalStatement.findFirst.mockResolvedValue(null as never);

    prismaMock.order.findMany.mockResolvedValue([
      { provider: 'stripe_platform', amount: 5000, commissionAmount: 250, netAmount: 4750 },
      { provider: 'stripe_platform', amount: 3000, commissionAmount: 150, netAmount: 2850 },
      { provider: 'cashapp_manual', amount: 4000, commissionAmount: 200, netAmount: 3800 },
      { provider: 'stripe_connect', amount: 10000, commissionAmount: 500, netAmount: 9500 },
    ] as never);
    prismaMock.orderStatusEvent.findMany.mockResolvedValue([{ order: { amount: 1200 } }] as never);
    prismaMock.commissionCharge.findMany.mockResolvedValue([
      {
        amountCents: 200,
        kind: 'SALE',
        createdAt: new Date('2026-02-10T00:00:00Z'),
        order: { orderNumber: 42 },
      },
      {
        amountCents: 150,
        kind: 'SALE',
        createdAt: new Date('2026-02-20T00:00:00Z'),
        order: { orderNumber: 51 },
      },
    ] as never);

    const built = await buildStatementForWithdrawal(prismaMock as never, 'wd-1');
    expect(built).not.toBeNull();
    const { data } = built!;

    expect(built!.storeId).toBe('store-1');
    expect(built!.periodFrom).toEqual(STORE.createdAt);
    expect(built!.periodTo).toEqual(new Date('2026-03-02T12:00:00Z'));

    // sales grouped, sorted by gross desc → connect (10000) first
    expect(data.sales.map((s) => s.provider)).toEqual([
      'stripe_connect',
      'stripe_platform',
      'cashapp_manual',
    ]);
    const platform = data.sales.find((s) => s.provider === 'stripe_platform')!;
    expect(platform).toMatchObject({
      orderCount: 2,
      grossCents: 8000,
      commissionCents: 400,
      netCents: 7600,
      settlement: 'vendylio',
    });
    expect(data.salesTotals).toEqual({
      orderCount: 4,
      grossCents: 22000,
      commissionCents: 1100,
      netCents: 20900,
    });

    expect(data.refunds).toEqual({ orderCount: 1, amountCents: 1200 });
    expect(data.taxCents).toBe(0);

    expect(data.payout.commissionLines).toEqual([
      {
        orderNumber: 'VND-10042',
        kind: 'SALE',
        accruedAt: '2026-02-10T00:00:00.000Z',
        amountCents: 200,
      },
      {
        orderNumber: 'VND-10051',
        kind: 'SALE',
        accruedAt: '2026-02-20T00:00:00.000Z',
        amountCents: 150,
      },
    ]);
    expect(data.payout.grossCents).toBe(8500);
    expect(data.payout.commissionWithheldCents).toBe(350);
    expect(data.payout.netPayableCents).toBe(8150);
    expect(built!.netPayableCents).toBe(8150);

    // stored summary columns
    expect(built!.grossSalesCents).toBe(22000);
    expect(built!.totalDeductionsCents).toBe(1100 + 1200 + 0);
  });

  it('chains periodFrom from the previous statement periodTo', async () => {
    prismaMock.withdrawal.findUnique.mockResolvedValue(baseWithdrawal() as never);
    prismaMock.withdrawalStatement.findFirst.mockResolvedValue({
      periodTo: new Date('2026-02-15T00:00:00Z'),
    } as never);
    prismaMock.order.findMany.mockResolvedValue([] as never);
    prismaMock.orderStatusEvent.findMany.mockResolvedValue([] as never);
    prismaMock.commissionCharge.findMany.mockResolvedValue([] as never);

    const built = await buildStatementForWithdrawal(prismaMock as never, 'wd-1');
    expect(built!.periodFrom).toEqual(new Date('2026-02-15T00:00:00Z'));
    const orderWhere = prismaMock.order.findMany.mock.calls[0]?.[0]?.where as {
      paidAt: { gte: Date; lt: Date };
    };
    expect(orderWhere.paidAt.gte).toEqual(new Date('2026-02-15T00:00:00Z'));
    expect(orderWhere.paidAt.lt).toEqual(new Date('2026-03-02T12:00:00Z'));
  });
});
