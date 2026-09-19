/**
 * Financial architecture (Phase 2D) — authoritative Stripe processing-fee
 * capture. Completely separate from Vendylio's own commission
 * (calculateMarketplaceFee / Order.commissionAmount): this file only reads
 * what Stripe itself charged for processing the payment, from Stripe's own
 * Balance Transaction record, and persists it to Order.stripeFeeCents +
 * one FinancialEvent(STRIPE_FEE_RECORDED). Never derives a fee from a
 * percentage, from order.amount, or from application_fee_amount.
 *
 * Two entry points call `recordStripeFee` with identical semantics:
 *   - the opportunistic postCommit hook in webhooks/stripe/route.ts (runs
 *     once, right after a payment is confirmed — usually succeeds since
 *     Stripe often attaches the balance_transaction within seconds)
 *   - the stripe-fee-capture-sweep cron (the guaranteed-eventually-
 *     consistent fallback for whatever the fast path missed)
 * Neither path runs inside the webhook's Serializable transaction — an
 * external Stripe call has no place holding that transaction open, and a
 * Balance Transaction that isn't ready yet must never fail or roll back a
 * payment that already succeeded.
 */
import 'server-only';
import Stripe from 'stripe';
import { Prisma, type PrismaClient } from '@prisma/client';
import { STRIPE_API_VERSION } from './stripe';
import { createLogger } from '../logger';

const log = createLogger();

export class StripeFeeCaptureUnconfiguredError extends Error {
  constructor() {
    super('Stripe fee capture not configured (STRIPE_SECRET_KEY missing or empty)');
    this.name = 'StripeFeeCaptureUnconfiguredError';
  }
}

let _client: Stripe | null = null;

function getClient(): Stripe {
  if (_client) return _client;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) throw new StripeFeeCaptureUnconfiguredError();
  _client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });
  return _client;
}

/** Test-only escape hatch — clears the cached client for `vi.stubEnv` reuse. */
export function __resetStripeFeeCaptureClient(): void {
  _client = null;
}

export interface StripeFeeResult {
  /** Stripe's own processing fee, integer smallest currency unit. */
  feeCents: number;
  chargeId: string;
  balanceTransactionId: string;
  /** Lowercase, as Stripe returns it (e.g. "usd"). */
  currency: string;
}

export type StripeFeeCaptureError =
  /** The Charge exists but Stripe hasn't attached a Balance Transaction to
   *  it yet — retry later, this is the expected/common transient state. */
  | { kind: 'NOT_AVAILABLE_YET'; reason: string }
  /** The PaymentIntent/Charge id itself doesn't resolve to anything on
   *  Stripe's side — retrying won't help. */
  | { kind: 'NOT_FOUND'; reason: string }
  /** A transient Stripe API/network problem — retry later. */
  | { kind: 'STRIPE_ERROR'; reason: string };

export type StripeFeeCaptureResult =
  | { ok: true; result: StripeFeeResult }
  | { ok: false; error: StripeFeeCaptureError };

/**
 * Retrieves the authoritative Stripe fee for one payment.
 * PaymentIntent → latest_charge → balance_transaction.fee, expanded in a
 * single call (no separate Charge/BalanceTransaction round-trip).
 *
 * Phase 2D.1 correction: Vendylio's Connect charges (`chargeConnected` in
 * `payments/stripe.ts`) are DESTINATION charges — created via
 * `payment_intent_data.transfer_data.destination`, with no `stripeAccount`
 * request option at creation. A destination charge's Checkout Session,
 * PaymentIntent, Charge, and Balance Transaction all live on the PLATFORM
 * Stripe account; only the settled funds move to the connected account via
 * an automatic Transfer afterward. Retrieval here must therefore never pass
 * a `stripeAccount` option either — for stripe_platform OR stripe_connect
 * orders alike. (An earlier version of this function accepted a
 * `stripeAccount` option and callers resolved the store's connected account
 * id for stripe_connect orders — that was retrieving the wrong account
 * context and would have 404'd every stripe_connect fee capture in
 * production; confirmed by direct inspection of the Connect charge-creation
 * code before this correction shipped.)
 */
export async function getStripeFeeForPayment(opts: {
  paymentIntentId: string;
}): Promise<StripeFeeCaptureResult> {
  const stripe = getClient();
  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(opts.paymentIntentId, {
      expand: ['latest_charge.balance_transaction'],
    });
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      if (err.code === 'resource_missing') {
        return { ok: false, error: { kind: 'NOT_FOUND', reason: err.message } };
      }
      return { ok: false, error: { kind: 'STRIPE_ERROR', reason: err.message } };
    }
    throw err;
  }

  const charge = pi.latest_charge;
  if (!charge || typeof charge === 'string') {
    return {
      ok: false,
      error: { kind: 'NOT_AVAILABLE_YET', reason: 'latest_charge not present/expanded yet' },
    };
  }
  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === 'string') {
    return {
      ok: false,
      error: { kind: 'NOT_AVAILABLE_YET', reason: 'balance_transaction not attached yet' },
    };
  }

  return {
    ok: true,
    result: {
      feeCents: balanceTransaction.fee,
      chargeId: charge.id,
      balanceTransactionId: balanceTransaction.id,
      currency: balanceTransaction.currency,
    },
  };
}

export type RecordStripeFeeOutcome =
  | { status: 'RECORDED'; feeCents: number }
  | { status: 'ALREADY_RECORDED' }
  | { status: 'SKIPPED_NOT_APPLICABLE'; reason: string }
  | { status: 'RETRY_LATER'; reason: string }
  | { status: 'CONFLICT'; existingFeeCents: number; newFeeCents: number };

/**
 * Orchestrates one Order's fee capture: retrieves the fee (platform account
 * context, always — see the Phase 2D.1 correction note on
 * getStripeFeeForPayment) and persists it + a FinancialEvent — idempotently.
 * Self-contained (re-reads the Order fresh) so both call sites (the webhook
 * postCommit hook and the sweep cron) share this exact logic rather than
 * two implementations that could drift.
 */
export async function recordStripeFee(
  prisma: PrismaClient,
  orderId: string,
): Promise<RecordStripeFeeOutcome> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      storeId: true,
      provider: true,
      paidAt: true,
      stripeFeeCents: true,
      stripePaymentIntentId: true,
    },
  });
  if (!order || !order.paidAt) {
    return { status: 'SKIPPED_NOT_APPLICABLE', reason: 'order missing or not yet paid' };
  }
  // Cash App / Zelle are manual/offline rails — no Stripe charge exists to
  // ask. Stripe Billing (Pro subscriptions) never reaches this function at
  // all (nothing in that flow calls it) — this check only needs to exclude
  // the two manual marketplace providers.
  if (order.provider !== 'stripe_platform' && order.provider !== 'stripe_connect') {
    return {
      status: 'SKIPPED_NOT_APPLICABLE',
      reason: `provider "${order.provider}" is not a Stripe marketplace rail`,
    };
  }
  if (!order.stripePaymentIntentId) {
    return { status: 'SKIPPED_NOT_APPLICABLE', reason: 'no stripePaymentIntentId on the order' };
  }

  // Phase 2D.1: no Store lookup / connected-account resolution needed here
  // — Vendylio's Connect charges are destination charges, so the
  // PaymentIntent lives on the platform account for stripe_platform AND
  // stripe_connect orders alike (see getStripeFeeForPayment's doc comment).
  const fetched = await getStripeFeeForPayment({ paymentIntentId: order.stripePaymentIntentId });
  if (!fetched.ok) {
    const level = fetched.error.kind === 'NOT_FOUND' ? 'error' : 'warn';
    log[level]('stripe-fee-capture: could not retrieve the fee', {
      orderId: order.id,
      paymentIntentId: order.stripePaymentIntentId,
      errorKind: fetched.error.kind,
      reason: fetched.error.reason,
    });
    return { status: 'RETRY_LATER', reason: fetched.error.reason };
  }

  const feeCents = fetched.result.feeCents;

  // Already recorded — verify it still matches rather than trusting it
  // blindly, so a genuine conflict (should never happen, but a Stripe-side
  // correction or a bug elsewhere would produce one) is caught instead of
  // silently coexisting with stale data.
  if (order.stripeFeeCents !== null) {
    if (order.stripeFeeCents === feeCents) return { status: 'ALREADY_RECORDED' };
    log.error(
      'stripe-fee-capture: conflicting fee for an already-recorded order — not overwriting',
      {
        orderId: order.id,
        existingFeeCents: order.stripeFeeCents,
        newFeeCents: feeCents,
      },
    );
    return { status: 'CONFLICT', existingFeeCents: order.stripeFeeCents, newFeeCents: feeCents };
  }

  // Atomic conditional write — only the caller that wins this race proceeds
  // to write the FinancialEvent, so a concurrent postCommit-hook-and-cron
  // overlap can never produce two events for the same order.
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, stripeFeeCents: null },
    data: { stripeFeeCents: feeCents },
  });
  if (claimed.count === 0) {
    const current = await prisma.order.findUnique({
      where: { id: order.id },
      select: { stripeFeeCents: true },
    });
    if (current?.stripeFeeCents === feeCents) return { status: 'ALREADY_RECORDED' };
    log.error('stripe-fee-capture: conflicting fee detected on a concurrent write', {
      orderId: order.id,
      existingFeeCents: current?.stripeFeeCents ?? null,
      newFeeCents: feeCents,
    });
    return {
      status: 'CONFLICT',
      existingFeeCents: current?.stripeFeeCents ?? 0,
      newFeeCents: feeCents,
    };
  }

  try {
    await prisma.financialEvent.create({
      data: {
        eventType: 'STRIPE_FEE_RECORDED',
        // sourceType stays within the closed vocabulary the FinancialEvent
        // model documents (Order | Withdrawal | CommissionCharge | Dispute) —
        // an Order has at most one Stripe fee fact, so (eventType, 'Order',
        // orderId) is already a deterministic, unique source identity; the
        // Stripe-side identifiers live in externalId/metadata instead.
        sourceType: 'Order',
        sourceId: order.id,
        storeId: order.storeId,
        orderId: order.id,
        // A Stripe processing fee is a cost to Vendylio — negative, matching
        // the signed-amount convention (positive = value toward the platform).
        amountCents: -feeCents,
        currency: fetched.result.currency.toUpperCase(),
        provider: 'stripe',
        externalId: fetched.result.balanceTransactionId,
        metadata: {
          paymentIntentId: order.stripePaymentIntentId,
          chargeId: fetched.result.chargeId,
          balanceTransactionId: fetched.result.balanceTransactionId,
        },
      },
    });
  } catch (err) {
    // A concurrent call already recorded this exact event — the Order write
    // above already resolved who "won", this only dedupes the event row.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
  }

  return { status: 'RECORDED', feeCents };
}
