import { describe, it, expect, vi, beforeEach } from 'vitest';

const isBillingConfigured = vi.fn(() => true);
const hasBillablePaymentMethod = vi.fn(async () => true);
const createCommissionInvoice = vi.fn(async () => ({ invoiceId: 'in_1' }));
vi.mock('./stripe-billing', () => ({
  isBillingConfigured: (...a: unknown[]) => isBillingConfigured(...(a as [])),
  hasBillablePaymentMethod: (...a: unknown[]) => hasBillablePaymentMethod(...(a as [])),
  createCommissionInvoice: (...a: unknown[]) => createCommissionInvoice(...(a as [])),
}));

import { settleInvoicedCommission, sweepCommissionSettlement } from './commission-settlement';

beforeEach(() => {
  vi.clearAllMocks();
  isBillingConfigured.mockReturnValue(true);
  hasBillablePaymentMethod.mockResolvedValue(true);
  createCommissionInvoice.mockResolvedValue({ invoiceId: 'in_1' });
});

describe('settleInvoicedCommission', () => {
  it('flips INVOICED rows carrying the invoice id to SETTLED', async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const tx = { commissionCharge: { updateMany } } as never;
    const n = await settleInvoicedCommission(tx, 'in_abc');
    expect(n).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { stripeInvoiceId: 'in_abc', status: 'INVOICED' },
      data: expect.objectContaining({ status: 'SETTLED' }),
    });
  });
});

describe('sweepCommissionSettlement', () => {
  function makePrisma(opts: {
    grouped: Array<{ storeId: string; _sum: { amountCents: number | null } }>;
    rowsByStore: Record<
      string,
      Array<{ id: string; amountCents: number; order: { orderNumber: number } }>
    >;
    stores: Record<string, { id: string; stripeCustomerId: string | null }>;
  }) {
    const updateMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    }));
    const groupBy = vi.fn(async () => opts.grouped);
    const prisma = {
      commissionCharge: {
        groupBy,
        findMany: vi.fn(
          async ({ where }: { where: { storeId: string } }) =>
            opts.rowsByStore[where.storeId] ?? [],
        ),
        updateMany,
      },
      store: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) => opts.stores[where.id] ?? null,
        ),
      },
    };
    return { updateMany, groupBy, prisma };
  }

  it('invoices a store whose OWED total clears the minimum', async () => {
    const { prisma, updateMany } = makePrisma({
      grouped: [{ storeId: 's1', _sum: { amountCents: 2500 } }],
      rowsByStore: {
        s1: [
          { id: 'c1', amountCents: 1500, order: { orderNumber: 1 } },
          { id: 'c2', amountCents: 1000, order: { orderNumber: 2 } },
        ],
      },
      stores: { s1: { id: 's1', stripeCustomerId: 'cus_1' } },
    });

    const res = await sweepCommissionSettlement(prisma as never, { min: 1000 });
    expect(createCommissionInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_1', storeId: 's1' }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] }, status: 'OWED' },
      data: { status: 'INVOICED', stripeInvoiceId: 'in_1' },
    });
    expect(res).toMatchObject({ storesInvoiced: 1, chargesInvoiced: 2, centsInvoiced: 2500 });
  });

  it('skips a store below the minimum', async () => {
    const { prisma } = makePrisma({
      grouped: [{ storeId: 's1', _sum: { amountCents: 400 } }],
      rowsByStore: {},
      stores: {},
    });
    const res = await sweepCommissionSettlement(prisma as never, { min: 1000 });
    expect(createCommissionInvoice).not.toHaveBeenCalled();
    expect(res.skippedBelowMin).toBe(1);
  });

  it('skips a store with no billing customer', async () => {
    const { prisma } = makePrisma({
      grouped: [{ storeId: 's1', _sum: { amountCents: 5000 } }],
      rowsByStore: { s1: [{ id: 'c1', amountCents: 5000, order: { orderNumber: 1 } }] },
      stores: { s1: { id: 's1', stripeCustomerId: null } },
    });
    const res = await sweepCommissionSettlement(prisma as never, { min: 1000 });
    expect(createCommissionInvoice).not.toHaveBeenCalled();
    expect(res.skippedNoCard).toBe(1);
  });

  it('skips a store with no card on file', async () => {
    hasBillablePaymentMethod.mockResolvedValueOnce(false);
    const { prisma } = makePrisma({
      grouped: [{ storeId: 's1', _sum: { amountCents: 5000 } }],
      rowsByStore: { s1: [{ id: 'c1', amountCents: 5000, order: { orderNumber: 1 } }] },
      stores: { s1: { id: 's1', stripeCustomerId: 'cus_1' } },
    });
    const res = await sweepCommissionSettlement(prisma as never, { min: 1000 });
    expect(res.skippedNoCard).toBe(1);
  });

  it('is inert when billing is not configured', async () => {
    isBillingConfigured.mockReturnValue(false);
    const { prisma } = makePrisma({ grouped: [], rowsByStore: {}, stores: {} });
    const res = await sweepCommissionSettlement(prisma as never);
    expect(res.storesInvoiced).toBe(0);
    expect(prisma.commissionCharge.groupBy).not.toHaveBeenCalled();
  });

  it('leaves rows OWED when Stripe invoice creation throws', async () => {
    createCommissionInvoice.mockRejectedValueOnce(new Error('stripe down'));
    const { prisma, updateMany } = makePrisma({
      grouped: [{ storeId: 's1', _sum: { amountCents: 5000 } }],
      rowsByStore: { s1: [{ id: 'c1', amountCents: 5000, order: { orderNumber: 1 } }] },
      stores: { s1: { id: 's1', stripeCustomerId: 'cus_1' } },
    });
    const res = await sweepCommissionSettlement(prisma as never, { min: 1000 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(res.storesInvoiced).toBe(0);
  });
});
