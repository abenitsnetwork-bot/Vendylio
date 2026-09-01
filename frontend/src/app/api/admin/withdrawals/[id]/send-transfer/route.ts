// POST /api/admin/withdrawals/[id]/send-transfer — Phase 2.
//
// SUPERADMIN fires the ACH payout for a BANK withdrawal: a Stripe Connect
// transfer from the platform balance to the seller's connected account
// (Stripe then pays it out to their bank on its own schedule). Semi-auto by
// design — no cron auto-sends transfers in v1; an operator reviews and clicks.
//
// Race-free, same invariant as .../cancel and .../complete: everything runs
// under pg_advisory_xact_lock(hashtext(userId)) in a Serializable tx. The
// external Stripe call can't sit inside a DB tx (it would hold locks across a
// network round-trip), so this is a three-step claim:
//   tx1: lock → re-check PENDING → flip to PROCESSING (claims the row)
//   Stripe: transfers.create with idempotencyKey wd-transfer-<id>
//   tx2: lock → PROCESSING → COMPLETED (+ providerPayoutId), or back to
//        FAILED with the Stripe error on failure
// The idempotency key means even a double-fire can't double-pay.
//
// Audit: action 'withdrawal.send_transfer', metadata { withdrawalId, amount,
// netAmount, currency, transferId, destinationAccountId }.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import Stripe from 'stripe';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { lockUserTx } from '@/lib/server/withdrawals/lock';
import { resolveOwnStore } from '@/lib/server/org';
import {
  createConnectTransfer,
  StripeConnectUnconfiguredError,
} from '@/lib/server/payments/stripe-connect';
import { createLogger } from '@/lib/server/logger';

const log = createLogger();

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;

    const w = await prisma.withdrawal.findUnique({
      where: { id },
      select: {
        userId: true,
        status: true,
        provider: true,
        amount: true,
        commissionSettledCents: true,
        currency: true,
      },
    });
    if (!w) {
      return NextResponse.json(
        { error: 'WITHDRAWAL_NOT_FOUND', message: 'Withdrawal not found.' },
        { status: 404 },
      );
    }
    if (w.provider !== 'stripe_transfer') {
      return NextResponse.json(
        {
          error: 'NOT_A_BANK_WITHDRAWAL',
          message: 'This withdrawal is not a bank/ACH payout — complete it manually instead.',
        },
        { status: 409 },
      );
    }
    if (w.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'WITHDRAWAL_NOT_SENDABLE', message: 'Withdrawal is not in a sendable state.' },
        { status: 409 },
      );
    }

    const store = await resolveOwnStore(w.userId);
    if (!store?.stripeAccountId || store.stripeOnboardingStatus !== 'ACTIVE') {
      return NextResponse.json(
        {
          error: 'CONNECT_ACCOUNT_UNAVAILABLE',
          message: "The seller's Stripe Connect account is not active — cannot transfer.",
        },
        { status: 422 },
      );
    }

    const netAmount = w.amount - w.commissionSettledCents;
    if (netAmount <= 0) {
      return NextResponse.json(
        { error: 'NOTHING_TO_TRANSFER', message: 'Net payout amount is zero.' },
        { status: 409 },
      );
    }

    // tx1 — claim the row (PENDING → PROCESSING) under the lock.
    const claimed = await prisma.$transaction(
      async (tx) => {
        await lockUserTx(tx, w.userId);
        const fresh = await tx.withdrawal.findUnique({ where: { id }, select: { status: true } });
        if (!fresh || fresh.status !== 'PENDING') return false;
        await tx.withdrawal.update({
          where: { id },
          data: { status: 'PROCESSING', processedAt: new Date() },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (!claimed) {
      return NextResponse.json(
        { error: 'WITHDRAWAL_NOT_SENDABLE', message: 'Withdrawal is no longer pending.' },
        { status: 409 },
      );
    }

    // Stripe transfer — outside any DB tx. Idempotency key makes a retry safe.
    let transferId: string;
    try {
      const res = await createConnectTransfer({
        destinationAccountId: store.stripeAccountId,
        amountCents: netAmount,
        currency: w.currency,
        withdrawalId: id,
      });
      transferId = res.transferId;
    } catch (err) {
      const reason =
        err instanceof StripeConnectUnconfiguredError
          ? 'Stripe is not configured'
          : err instanceof Stripe.errors.StripeError
            ? (err.message ?? 'Stripe transfer failed')
            : 'Transfer failed';
      log.error('withdrawal send-transfer failed', { withdrawalId: id, reason });
      // Revert PROCESSING → FAILED so balance is released and an operator can
      // retry (reset to PENDING) or pay another way.
      await prisma.$transaction(
        async (tx) => {
          await lockUserTx(tx, w.userId);
          await tx.withdrawal.update({
            where: { id },
            data: { status: 'FAILED', failureReason: reason, completedAt: new Date() },
          });
          await logAdminAction(tx, {
            actorId: auth.admin.id,
            action: 'withdrawal.send_transfer_failed',
            targetType: 'Withdrawal',
            targetId: id,
            metadata: { withdrawalId: id, amount: w.amount, reason },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return NextResponse.json({ error: 'TRANSFER_FAILED', message: reason }, { status: 502 });
    }

    // tx2 — PROCESSING → COMPLETED. The funds have left the platform; the
    // connected account holds them and Stripe ACHs to the bank on schedule.
    // A later `transfer.reversed` (Connect webhook) flips this to FAILED.
    const updated = await prisma.$transaction(
      async (tx) => {
        await lockUserTx(tx, w.userId);
        const now = new Date();
        const row = await tx.withdrawal.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            provider: 'stripe_transfer',
            providerPayoutId: transferId,
            processedAt: now,
            completedAt: now,
          },
        });
        await logAdminAction(tx, {
          actorId: auth.admin.id,
          action: 'withdrawal.send_transfer',
          targetType: 'Withdrawal',
          targetId: id,
          metadata: {
            withdrawalId: id,
            amount: w.amount,
            netAmount,
            currency: w.currency,
            transferId,
            destinationAccountId: store.stripeAccountId,
          },
        });
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return NextResponse.json({ withdrawal: updated, transferId }, { status: 200 });
  });
}
