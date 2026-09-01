// Phase 1b — the outstanding-commission receivable + the FIFO settlement plan
// used when a merchant requests a withdrawal (api/withdrawals/route.ts).
import { describe, it, expect, vi } from 'vitest';
import { owedCommissionCents, planCommissionSettlement } from './owed';

function client(rows: Array<{ id?: string; amountCents: number }>) {
  return {
    commissionCharge: {
      findMany: vi.fn(async () => rows),
    },
  } as never;
}

describe('owedCommissionCents', () => {
  it('sums every OWED charge for the store', async () => {
    const c = client([{ amountCents: 216 }, { amountCents: 84 }, { amountCents: 100 }]);
    await expect(owedCommissionCents(c, 'store-1')).resolves.toBe(400);
  });

  it('is 0 when nothing is owed', async () => {
    await expect(owedCommissionCents(client([]), 'store-1')).resolves.toBe(0);
  });

  it('nets a REFUND_CREDIT (negative) against the positives', async () => {
    const c = client([{ amountCents: 300 }, { amountCents: -120 }]);
    await expect(owedCommissionCents(c, 'store-1')).resolves.toBe(180);
  });

  it('filters to status OWED for the given store', async () => {
    const c = client([{ amountCents: 50 }]);
    await owedCommissionCents(c, 'store-9');
    expect(
      (c as never as { commissionCharge: { findMany: ReturnType<typeof vi.fn> } }).commissionCharge
        .findMany,
    ).toHaveBeenCalledWith({
      where: { storeId: 'store-9', status: 'OWED' },
      select: { amountCents: true },
    });
  });
});

describe('planCommissionSettlement', () => {
  it('settles every positive charge FIFO', async () => {
    const c = client([
      { id: 'a', amountCents: 200 },
      { id: 'b', amountCents: 100 },
    ]);
    const plan = await planCommissionSettlement(c, 'store-1', 1000);
    expect(plan).toEqual({ settledCents: 300, chargeIds: ['a', 'b'] });
  });

  it('returns an empty plan when nothing is owed', async () => {
    const plan = await planCommissionSettlement(client([]), 'store-1', 1000);
    expect(plan).toEqual({ settledCents: 0, chargeIds: [] });
  });

  it('applies a REFUND_CREDIT that keeps the gross payout non-negative', async () => {
    const c = client([{ id: 'credit', amountCents: -300 }]);
    const plan = await planCommissionSettlement(c, 'store-1', 1000);
    expect(plan).toEqual({ settledCents: -300, chargeIds: ['credit'] });
  });

  it('skips a REFUND_CREDIT larger than the payout (stays OWED for next time)', async () => {
    const c = client([{ id: 'credit', amountCents: -5000 }]);
    const plan = await planCommissionSettlement(c, 'store-1', 1000);
    expect(plan).toEqual({ settledCents: 0, chargeIds: [] });
  });

  it('applies a credit only after an earlier positive covers it', async () => {
    const c = client([
      { id: 'sale', amountCents: 200 },
      { id: 'credit', amountCents: -1500 },
    ]);
    // netAmount 1000 + 200 settled = 1200; 1200 + (−1500) = −300 < 0 → skip credit
    const plan = await planCommissionSettlement(c, 'store-1', 1000);
    expect(plan).toEqual({ settledCents: 200, chargeIds: ['sale'] });
  });
});
