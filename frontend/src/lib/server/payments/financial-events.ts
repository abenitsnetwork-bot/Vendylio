/**
 * Financial architecture (Phase 2E) — FinancialEvent writers for the
 * payment/refund lifecycle. FinancialEvent is append-only, immutable,
 * auditable — NOT event sourcing, NOT the operational source of truth
 * (Order/CommissionCharge/Withdrawal/Dispute stay authoritative). Every
 * writer here runs INSIDE the caller's already-open Serializable
 * transaction (the Stripe webhook's onPaid/onDispute, or
 * applyOrderRefundedEffects) — unlike stripe-fee-capture.ts (Phase 2D),
 * which deliberately runs outside any transaction because it makes an
 * external Stripe call. Nothing here calls Stripe.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';

export type FinancialEventType =
  | 'PAYMENT_SUCCEEDED'
  | 'REFUND_COMPLETED'
  | 'APPLICATION_FEE_CREATED'
  | 'APPLICATION_FEE_REVERSED'
  | 'DISPUTE_OPENED'
  | 'DISPUTE_UPDATED'
  | 'DISPUTE_CLOSED'
  | 'RECONCILIATION_DISCREPANCY';

export type FinancialEventSourceType = 'Order' | 'Withdrawal' | 'CommissionCharge' | 'Dispute';

interface WriteFinancialEventInput {
  eventType: FinancialEventType;
  sourceType: FinancialEventSourceType;
  /** Combined with (eventType, sourceType) as the idempotency identity —
   *  see the Phase 2A `@@unique([eventType, sourceType, sourceId])`
   *  constraint. Not always the raw row id — see disputes.ts for why
   *  DISPUTE_UPDATED folds a status into this. */
  sourceId: string;
  storeId?: string | null;
  orderId?: string | null;
  amountCents?: number | null;
  currency?: string;
  provider?: string | null;
  externalId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Idempotent FinancialEvent writer for callers already inside a Serializable
 * transaction. Reads first rather than create-then-catch-P2002: once a
 * statement inside a Prisma interactive transaction throws, Postgres marks
 * the whole transaction aborted and every later statement fails too (even a
 * caught one) — so a duplicate must never reach `create()` at all. A
 * genuine concurrent race between two SEPARATE transactions is still caught
 * correctly: Serializable isolation aborts one of them wholesale, the same
 * guarantee the withdrawal advisory-lock pattern already relies on
 * elsewhere in this codebase — stronger than a mid-transaction unique-
 * constraint catch could give anyway.
 */
export async function writeFinancialEventOnce(
  tx: PrismaTransactionClient,
  input: WriteFinancialEventInput,
): Promise<void> {
  const existing = await tx.financialEvent.findUnique({
    where: {
      eventType_sourceType_sourceId: {
        eventType: input.eventType,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    },
    select: { id: true },
  });
  if (existing) return;

  await tx.financialEvent.create({
    data: {
      eventType: input.eventType,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      storeId: input.storeId ?? null,
      orderId: input.orderId ?? null,
      amountCents: input.amountCents ?? null,
      currency: input.currency ?? 'USD',
      provider: input.provider ?? null,
      externalId: input.externalId ?? null,
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    },
  });
}

export interface PaymentSucceededOrder {
  id: string;
  storeId: string;
  amount: number;
  currency: string;
  provider: string;
}

/** Integrates with the Stripe `checkout.session.completed` flow (the
 *  webhook's onPaid) — NOT emitted for Cash App / Zelle manual-money
 *  confirmations, which have no Stripe payment behind them. */
export async function recordPaymentSucceeded(
  tx: PrismaTransactionClient,
  order: PaymentSucceededOrder,
  opts: { stripeSessionId?: string | null; stripePaymentIntentId?: string | null } = {},
): Promise<void> {
  await writeFinancialEventOnce(tx, {
    eventType: 'PAYMENT_SUCCEEDED',
    sourceType: 'Order',
    sourceId: order.id,
    storeId: order.storeId,
    orderId: order.id,
    amountCents: order.amount,
    currency: order.currency,
    provider: order.provider,
    externalId: opts.stripePaymentIntentId ?? opts.stripeSessionId ?? null,
    metadata: {
      ...(opts.stripeSessionId ? { sessionId: opts.stripeSessionId } : {}),
      ...(opts.stripePaymentIntentId ? { paymentIntentId: opts.stripePaymentIntentId } : {}),
    },
  });
}

export interface RefundCompletedOrder {
  id: string;
  storeId: string;
  amount: number;
  currency: string;
}

/** Full refunds only (MVP) — mirrors applyOrderRefundedEffects itself,
 *  which never creates a partial refund. amountCents is the FULL negated
 *  order.amount; partial-refund accounting is explicitly out of scope for
 *  this phase (the existing architecture already only detects/processes
 *  full refunds — see refund.ts and the onRefunded charge.refunded=false
 *  skip in webhooks/stripe/route.ts). */
export async function recordRefundCompleted(
  tx: PrismaTransactionClient,
  order: RefundCompletedOrder,
): Promise<void> {
  await writeFinancialEventOnce(tx, {
    eventType: 'REFUND_COMPLETED',
    sourceType: 'Order',
    sourceId: order.id,
    storeId: order.storeId,
    orderId: order.id,
    amountCents: -order.amount,
    currency: order.currency,
  });
}

export interface ApplicationFeeOrder {
  id: string;
  storeId: string;
  /** The frozen Order.commissionAmount (Phase 2B) — never recalculated,
   *  never re-resolved from PlatformSettings here. */
  commissionAmount: number;
  currency: string;
}

/** Stripe Connect destination charges ONLY — the caller guards on
 *  order.provider === 'stripe_connect' before calling this. A platform
 *  charge has no Stripe Connect application fee, so no event is written
 *  for it (the Vendylio commission itself still exists operationally on
 *  Order.commissionAmount — this event specifically represents the Stripe
 *  Connect application-fee fact, not the commission decision). */
export async function recordApplicationFeeCreated(
  tx: PrismaTransactionClient,
  order: ApplicationFeeOrder,
  opts: { stripePaymentIntentId?: string | null } = {},
): Promise<void> {
  await writeFinancialEventOnce(tx, {
    eventType: 'APPLICATION_FEE_CREATED',
    sourceType: 'Order',
    sourceId: order.id,
    storeId: order.storeId,
    orderId: order.id,
    amountCents: order.commissionAmount,
    currency: order.currency,
    provider: 'stripe',
    externalId: opts.stripePaymentIntentId ?? null,
    metadata: opts.stripePaymentIntentId ? { paymentIntentId: opts.stripePaymentIntentId } : {},
  });
}
