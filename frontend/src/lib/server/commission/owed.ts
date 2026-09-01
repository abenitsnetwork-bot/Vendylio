// Phase 1b — the platform's outstanding marketplace-commission receivable
// against one store: the sum of every OWED CommissionCharge (Cash App / Zelle
// orders whose cut hasn't been collected yet).
//
// Positive  = the merchant owes the platform.
// Negative  = the platform owes the merchant a credit (a REFUND_CREDIT row for
//             commission that was already settled/invoiced before the refund).
//
// This is subtracted from the merchant's withdrawable balance (a wrapped
// BalanceComputer in api/withdrawals/route.ts — `balance.ts` itself is left
// untouched) and cleared either by withholding it from a withdrawal
// (settleOwedCommissionCharges) or a Stripe invoice.
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import type { TxClient } from '@/lib/server/withdrawals/lock';

type CommissionClient = Pick<PrismaClient, 'commissionCharge'>;

export async function owedCommissionCents(
  client: CommissionClient | TxClient,
  storeId: string,
): Promise<number> {
  const rows = await (client as CommissionClient).commissionCharge.findMany({
    where: { storeId, status: 'OWED' },
    select: { amountCents: true },
  });
  return rows.reduce((sum, r) => sum + r.amountCents, 0);
}

export interface CommissionSettlementPlan {
  /** Total withheld from the payout (can be negative when credits dominate). */
  settledCents: number;
  /** CommissionCharge ids to flip OWED → SETTLED. */
  chargeIds: string[];
}

/**
 * Decide which OWED charges a withdrawal of `netAmount` (the amount the
 * merchant will actually receive) settles. FIFO by `createdAt`; a
 * REFUND_CREDIT (negative) is only applied if doing so keeps the gross payout
 * (`netAmount + runningTotal`) non-negative — otherwise it stays OWED for next
 * time. Positive charges always settle (the balance guard already proved
 * `netAmount ≤ base − owed`, so `netAmount + owed ≤ base`).
 *
 * Pure read + arithmetic — the caller does the writes inside its tx.
 */
export async function planCommissionSettlement(
  client: CommissionClient | TxClient,
  storeId: string,
  netAmount: number,
): Promise<CommissionSettlementPlan> {
  const rows = await (client as CommissionClient).commissionCharge.findMany({
    where: { storeId, status: 'OWED' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amountCents: true },
  });

  let settledCents = 0;
  const chargeIds: string[] = [];
  for (const row of rows) {
    if (netAmount + settledCents + row.amountCents < 0) continue; // skip a credit that would overshoot
    settledCents += row.amountCents;
    chargeIds.push(row.id);
  }
  return { settledCents, chargeIds };
}
