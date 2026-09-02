// Post-commit hook: after an operator marks a Withdrawal COMPLETED (or a BANK
// send-transfer succeeds), build + persist its statement. Best-effort and
// idempotent — a failure here never touches withdrawal state, and a re-run
// (retry, double webhook) is a no-op once the row exists.
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/server/prisma';
import { createLogger } from '@/lib/server/logger';
import { buildStatementForWithdrawal } from './build';

const log = createLogger();

export async function generateStatementForWithdrawal(withdrawalId: string): Promise<void> {
  try {
    const existing = await prisma.withdrawalStatement.findUnique({
      where: { withdrawalId },
      select: { id: true },
    });
    if (existing) return;

    const built = await buildStatementForWithdrawal(prisma, withdrawalId);
    if (!built) return;

    await prisma.withdrawalStatement.create({
      data: {
        withdrawalId,
        storeId: built.storeId,
        periodFrom: built.periodFrom,
        periodTo: built.periodTo,
        currency: built.currency,
        data: built.data as unknown as Prisma.InputJsonValue,
        grossSalesCents: built.grossSalesCents,
        totalDeductionsCents: built.totalDeductionsCents,
        netPayableCents: built.netPayableCents,
      },
    });
    log.info('withdrawal statement generated', { withdrawalId });
  } catch (err) {
    // P2002 — a concurrent generate already created it. Anything else is a
    // genuine hiccup; the statement can be regenerated later if needed.
    log.warn('withdrawal statement generation failed', {
      withdrawalId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
