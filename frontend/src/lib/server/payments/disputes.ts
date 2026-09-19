/**
 * Financial architecture (Phase 2E) — Stripe dispute persistence + the
 * DISPUTE_OPENED / DISPUTE_UPDATED / DISPUTE_CLOSED FinancialEvent trail.
 * Informational/auditable only: never mutates Order.status, never touches
 * computeBalance(), never creates a clawback/withdrawal/payout. Whether a
 * LOST dispute should later claw back an already-paid-out commission is an
 * open business decision, not decided here (see the Dispute model comment
 * in schema.prisma).
 *
 * Vendylio only ever creates Stripe Connect DESTINATION charges (never
 * direct charges on a connected account) — the Charge object, and every
 * dispute against it, therefore lives on the PLATFORM account regardless
 * of whether the order was stripe_platform or stripe_connect. That's why,
 * unlike stripe-fee-capture.ts, nothing here ever needs a `stripeAccount`
 * request option or a second Stripe API call: the full Stripe.Dispute
 * object already arrives in the webhook payload itself.
 */
import 'server-only';
import type Stripe from 'stripe';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';
import { writeFinancialEventOnce } from './financial-events';
import { createLogger } from '../logger';

const log = createLogger();

export type NormalizedDisputeStatus =
  | 'NEEDS_RESPONSE'
  | 'UNDER_REVIEW'
  | 'WON'
  | 'LOST'
  | 'WARNING_CLOSED';

/**
 * Maps Stripe's own `Dispute.status` vocabulary — confirmed against the
 * installed Stripe SDK typings (node_modules/stripe/.../Disputes.d.ts):
 * 'needs_response' | 'warning_needs_response' | 'under_review' |
 * 'warning_under_review' | 'won' | 'lost' | 'warning_closed' | 'prevented'
 * (+ an open-ended OtherString for future values) — onto Vendylio's five
 * normalized statuses.
 *
 * `warning_closed` is Stripe's own explicit distinction for an early-
 * fraud-warning that closed WITHOUT becoming a formal dispute — preserved
 * as its own WARNING_CLOSED value, per the Dispute model's status comment.
 * `prevented` (Stripe's dispute-protection outcome — the charge stands, no
 * funds ever left the platform) maps to WON, the closest existing
 * financial outcome. An unrecognized future value falls back to
 * UNDER_REVIEW (still needs attention) rather than guessing at a terminal
 * outcome, and is logged so it can be triaged.
 */
export function mapStripeDisputeStatus(
  stripeStatus: Stripe.Dispute.Status,
): NormalizedDisputeStatus {
  switch (stripeStatus) {
    case 'needs_response':
    case 'warning_needs_response':
      return 'NEEDS_RESPONSE';
    case 'under_review':
    case 'warning_under_review':
      return 'UNDER_REVIEW';
    case 'won':
      return 'WON';
    case 'lost':
      return 'LOST';
    case 'warning_closed':
      return 'WARNING_CLOSED';
    case 'prevented':
      return 'WON';
    default:
      log.warn('stripe dispute webhook: unrecognized dispute status, defaulting to UNDER_REVIEW', {
        stripeStatus,
      });
      return 'UNDER_REVIEW';
  }
}

// Forward-only rank, mirroring the fulfillment state machine's never-
// regress rule (lib/server/fulfillment/stateMachine.ts) — Stripe does not
// guarantee webhook delivery order (CLAUDE.md / brief §14), so a stale
// `charge.dispute.created` payload arriving after a later `updated`/
// `closed` must never walk a dispute's status backwards.
const DISPUTE_STATUS_RANK: Record<NormalizedDisputeStatus, number> = {
  NEEDS_RESPONSE: 0,
  UNDER_REVIEW: 1,
  WON: 2,
  LOST: 2,
  WARNING_CLOSED: 2,
};

interface DisputeFields {
  amountCents: number;
  currency: string;
  reason: string | null;
  status: NormalizedDisputeStatus;
  evidenceDueBy: Date | null;
}

function disputeFieldsFrom(dispute: Stripe.Dispute): DisputeFields {
  const dueBySeconds = dispute.evidence_details?.due_by ?? null;
  return {
    amountCents: dispute.amount,
    currency: dispute.currency.toUpperCase(),
    reason: dispute.reason ?? null,
    status: mapStripeDisputeStatus(dispute.status),
    evidenceDueBy: dueBySeconds ? new Date(dueBySeconds * 1000) : null,
  };
}

function paymentIntentIdOf(pi: string | Stripe.PaymentIntent | null | undefined): string | null {
  if (!pi) return null;
  return typeof pi === 'string' ? pi : pi.id;
}

/**
 * Resolves the Vendylio Order behind a Stripe dispute via
 * Order.stripePaymentIntentId (the same identifier `charge.refunded`
 * already matches on — see webhooks/stripe/route.ts's onRefunded). Never
 * fabricates an Order and never throws for an unmapped dispute — logs and
 * lets the caller skip, per brief §12.
 */
async function resolveOrderForDispute(
  tx: PrismaTransactionClient,
  dispute: Stripe.Dispute,
): Promise<{ id: string; storeId: string } | null> {
  const pi = paymentIntentIdOf(dispute.payment_intent);
  if (!pi) {
    log.warn('stripe dispute webhook: dispute carries no payment_intent — cannot match an order', {
      disputeId: dispute.id,
    });
    return null;
  }
  const order = await tx.order.findFirst({
    where: { stripePaymentIntentId: pi },
    select: { id: true, storeId: true },
  });
  if (!order) {
    log.warn('stripe dispute webhook: dispute for an unknown payment_intent', {
      disputeId: dispute.id,
      paymentIntentId: pi,
    });
    return null;
  }
  return order;
}

/**
 * Upserts the Dispute row by stripeDisputeId, applying the forward-only
 * status guard. Returns the row id + the fields actually persisted (which
 * may differ from the raw incoming payload if the status guard held the
 * line) so the caller's FinancialEvent reflects what's really on the row.
 */
async function upsertDisputeRow(
  tx: PrismaTransactionClient,
  order: { id: string; storeId: string },
  dispute: Stripe.Dispute,
): Promise<{ id: string; fields: DisputeFields }> {
  const fields = disputeFieldsFrom(dispute);
  const existing = await tx.dispute.findUnique({
    where: { stripeDisputeId: dispute.id },
    select: { id: true, status: true },
  });

  if (!existing) {
    const row = await tx.dispute.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        stripeDisputeId: dispute.id,
        ...fields,
      },
      select: { id: true },
    });
    return { id: row.id, fields };
  }

  const existingStatus = existing.status as NormalizedDisputeStatus;
  const nextStatus =
    DISPUTE_STATUS_RANK[fields.status] >= DISPUTE_STATUS_RANK[existingStatus]
      ? fields.status
      : existingStatus;

  await tx.dispute.update({
    where: { id: existing.id },
    data: { ...fields, status: nextStatus },
  });
  return { id: existing.id, fields: { ...fields, status: nextStatus } };
}

export async function handleDisputeCreated(
  tx: PrismaTransactionClient,
  dispute: Stripe.Dispute,
): Promise<void> {
  const order = await resolveOrderForDispute(tx, dispute);
  if (!order) return;
  const { id, fields } = await upsertDisputeRow(tx, order, dispute);
  await writeFinancialEventOnce(tx, {
    eventType: 'DISPUTE_OPENED',
    sourceType: 'Dispute',
    sourceId: id,
    storeId: order.storeId,
    orderId: order.id,
    // A dispute is adverse financial exposure — negative, per the
    // established signed-amount convention.
    amountCents: -fields.amountCents,
    currency: fields.currency,
    provider: 'stripe',
    externalId: dispute.id,
    metadata: { reason: fields.reason, status: fields.status },
  });
}

export async function handleDisputeUpdated(
  tx: PrismaTransactionClient,
  dispute: Stripe.Dispute,
): Promise<void> {
  const order = await resolveOrderForDispute(tx, dispute);
  if (!order) return;
  const { id, fields } = await upsertDisputeRow(tx, order, dispute);
  // Identity note: the Phase 2A `@@unique([eventType, sourceType,
  // sourceId])` constraint can only represent ONE fact per (eventType,
  // sourceType, sourceId) — but a single dispute legitimately passes
  // through several distinct, audit-worthy statuses over its lifetime
  // (e.g. NEEDS_RESPONSE -> UNDER_REVIEW). Folding the status into the
  // sourceId keeps each real transition as its own event, while a
  // REPLAYED `updated` webhook reporting a status already recorded
  // collides on the same identity and is silently absorbed by
  // writeFinancialEventOnce's idempotency check — without touching the
  // schema. See Phase 2E report for why this isn't a schema conflict.
  await writeFinancialEventOnce(tx, {
    eventType: 'DISPUTE_UPDATED',
    sourceType: 'Dispute',
    sourceId: `${id}:${fields.status}`,
    storeId: order.storeId,
    orderId: order.id,
    amountCents: -fields.amountCents,
    currency: fields.currency,
    provider: 'stripe',
    externalId: dispute.id,
    metadata: { reason: fields.reason, status: fields.status },
  });
}

export async function handleDisputeClosed(
  tx: PrismaTransactionClient,
  dispute: Stripe.Dispute,
): Promise<void> {
  const order = await resolveOrderForDispute(tx, dispute);
  if (!order) return;
  const { id, fields } = await upsertDisputeRow(tx, order, dispute);
  await writeFinancialEventOnce(tx, {
    eventType: 'DISPUTE_CLOSED',
    sourceType: 'Dispute',
    sourceId: id,
    storeId: order.storeId,
    orderId: order.id,
    amountCents: -fields.amountCents,
    currency: fields.currency,
    provider: 'stripe',
    externalId: dispute.id,
    metadata: { reason: fields.reason, status: fields.status },
  });
}
