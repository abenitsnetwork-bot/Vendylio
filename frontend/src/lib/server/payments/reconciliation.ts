/**
 * Financial architecture (Phase 2F, widened in Phase 2F.1) — detection-only
 * Stripe payment reconciliation. Finds Orders Vendylio still thinks are
 * unpaid (PENDING or EXPIRED) while Stripe's own Checkout Session reports
 * `payment_status: 'paid'` (a missed or failed webhook delivery), and
 * records the fact as an immutable RECONCILIATION_DISCREPANCY
 * FinancialEvent. This service NEVER mutates operational payment state —
 * no Order.status write, no paidAt, no commission/CommissionCharge/
 * withdrawal/balance change, no call to applyOrderPaidEffects or any
 * equivalent. Repair is an explicit, out-of-scope future decision (see the
 * Dispute model's own precedent for "detect now, decide the business
 * treatment later").
 *
 * PENDING *and* EXPIRED (Phase 2F.1): the original Phase 2F brief scoped
 * eligibility to `status = PENDING` only. In practice the `order-expiration`
 * cron (`orders/expire.ts`) already runs every 5 minutes and flips any
 * PENDING order whose expiresAt has passed to EXPIRED — so by the time this
 * DAILY cron ran, almost every order it was looking for had already been
 * moved out of the PENDING state it was filtering on, making the detector
 * find almost nothing in practice (flagged as an open issue in the Phase 2F
 * report). Phase 2F.1 widens eligibility to `status IN (PENDING, EXPIRED)`
 * to actually catch the case the order-expiration cron itself can't
 * distinguish: it flips PENDING → EXPIRED purely on `expiresAt < now`, with
 * no Stripe lookup, so a payment Stripe silently completed right at/after
 * expiry gets marked EXPIRED exactly like a genuinely abandoned cart. This
 * does NOT change order-expiration's own behavior at all — it remains the
 * sole authority for the PENDING → EXPIRED transition; reconciliation only
 * widens what it's allowed to *read* afterward.
 *
 * Eligibility note (deviates from a literal reading of the Phase 2F brief,
 * documented here per the brief's own §5 instruction to "inspect and use
 * the existing field rather than creating another"): the brief's §4 named
 * `Order.stripePaymentIntentId` as the required non-null eligibility field.
 * That field is ONLY ever written by the webhook's onPaid handler (see
 * markPaid.ts) — a genuinely-still-PENDING order (the exact case this
 * service exists to find) can never have it set, which would make
 * `status = PENDING AND stripePaymentIntentId != null` an always-empty
 * set. The field that actually identifies the Stripe Checkout Session for
 * an order — from the moment of creation, in api/orders/route.ts — is
 * `Order.providerChargeId` (the Checkout Session id, `cs_...`; see the
 * schema comment on that column and the webhook's own
 * `tx.order.findFirst({ where: { providerChargeId: session.id } })`
 * match). This service uses `providerChargeId` instead.
 *
 * Stripe account context: `payments/stripe.ts`'s `chargeConnected()` creates
 * the Checkout Session (and therefore its auto-attached PaymentIntent) via
 * `payment_intent_data.transfer_data.destination` — a Stripe Connect
 * DESTINATION charge — with no `stripeAccount` request option. Destination
 * charges keep the Charge/PaymentIntent/Checkout Session on the PLATFORM
 * account; only the settled funds move to the connected account via an
 * automatic Transfer. Confirmed by direct inspection of both `charge()` and
 * `chargeConnected()` (brief §8's own instruction: "if the existing
 * implementation proves all Checkout Sessions are created on the platform
 * account ... preserve that behavior"). So retrieval here never passes a
 * `stripeAccount` option, for either stripe_platform or stripe_connect
 * orders — see the Phase 2F report for a note on stripe-fee-capture.ts
 * (Phase 2D), which passes `stripeAccount` for stripe_connect and may be
 * retrieving the wrong account context; out of scope to fix here.
 */
import 'server-only';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { STRIPE_API_VERSION } from './stripe';
import { writeFinancialEventOnce } from './financial-events';
import { createLogger } from '../logger';

const log = createLogger();

export class StripeReconciliationUnconfiguredError extends Error {
  constructor() {
    super('Stripe reconciliation not configured (STRIPE_SECRET_KEY missing or empty)');
    this.name = 'StripeReconciliationUnconfiguredError';
  }
}

let _client: Stripe | null = null;

function getClient(): Stripe {
  if (_client) return _client;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) throw new StripeReconciliationUnconfiguredError();
  _client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });
  return _client;
}

/** Test-only escape hatch — clears the cached client for `vi.stubEnv` reuse. */
export function __resetStripeReconciliationClient(): void {
  _client = null;
}

const STRIPE_MARKETPLACE_PROVIDERS = ['stripe_platform', 'stripe_connect'];
// Phase 2F.1 — the only two statuses reconciliation is allowed to inspect.
// Deliberately excludes PAID/CANCELLED/REFUNDED/PREPARING/READY/
// OUT_FOR_DELIVERY/DELIVERED/FAILED (the full Order.status vocabulary, per
// schema.prisma) — those are either already-resolved-paid or terminal in a
// way that isn't "Vendylio thinks this never got paid."
const ELIGIBLE_STATUSES = ['PENDING', 'EXPIRED'];
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 200;

export interface EligibleOrder {
  id: string;
  storeId: string;
  provider: string;
  status: string;
  amount: number;
  currency: string;
  providerChargeId: string;
  expiresAt: Date;
}

/**
 * PENDING or EXPIRED Stripe-marketplace Orders whose Checkout Session has
 * expired (expiresAt < now) but not so long ago that a stale abandoned cart
 * still gets re-checked forever (expiresAt >= now - 7d). Narrow by design
 * (brief §13) — this is a daily integrity check, not a general Stripe sync
 * engine.
 */
export async function findEligibleOrders(
  prisma: PrismaClient,
  opts: { now?: Date; batchSize?: number } = {},
): Promise<EligibleOrder[]> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - LOOKBACK_MS);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  const rows = await prisma.order.findMany({
    where: {
      provider: { in: STRIPE_MARKETPLACE_PROVIDERS },
      status: { in: ELIGIBLE_STATUSES },
      providerChargeId: { not: null },
      expiresAt: { lt: now, gte: cutoff },
    },
    orderBy: { expiresAt: 'asc' },
    take: batchSize,
    select: {
      id: true,
      storeId: true,
      provider: true,
      status: true,
      amount: true,
      currency: true,
      providerChargeId: true,
      expiresAt: true,
    },
  });

  // providerChargeId is guaranteed non-null by the where-clause; Prisma's
  // generated select type keeps it nullable, so narrow it here rather than
  // making every caller re-check what the query already guarantees.
  return rows.map((r) => ({ ...r, providerChargeId: r.providerChargeId as string }));
}

export type ReconcileOutcome =
  | { status: 'DISCREPANCY_RECORDED' }
  | { status: 'ALREADY_RECORDED' }
  | { status: 'NO_DISCREPANCY'; stripePaymentStatus: string }
  | { status: 'NOT_FOUND' }
  | { status: 'STRIPE_ERROR'; reason: string };

/**
 * Retrieves one Order's Checkout Session from Stripe and compares state.
 * Read-only against Vendylio's operational data except for the one
 * permitted write: an idempotent RECONCILIATION_DISCREPANCY FinancialEvent.
 */
export async function reconcileOrder(
  prisma: PrismaClient,
  order: EligibleOrder,
): Promise<ReconcileOutcome> {
  const stripe = getClient();

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(order.providerChargeId);
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      if (err.code === 'resource_missing') {
        log.warn('reconciliation: Checkout Session not found on Stripe — skipping', {
          orderId: order.id,
          providerChargeId: order.providerChargeId,
        });
        return { status: 'NOT_FOUND' };
      }
      log.warn('reconciliation: Stripe API error — skipping', {
        orderId: order.id,
        providerChargeId: order.providerChargeId,
        reason: err.message,
      });
      return { status: 'STRIPE_ERROR', reason: err.message };
    }
    throw err;
  }

  // Only Stripe's literal 'paid' is a discrepancy — this mirrors the
  // webhook's own financial-integrity gate (onPaid in
  // webhooks/stripe/route.ts), which only ever fulfills on exactly 'paid'.
  // 'unpaid' is the normal abandoned-checkout case (why order-expiration
  // marks it EXPIRED); 'no_payment_required' is never treated as paid
  // anywhere in the existing order flow, so it isn't here either.
  if (session.payment_status !== 'paid') {
    return { status: 'NO_DISCREPANCY', stripePaymentStatus: session.payment_status };
  }

  const existing = await prisma.financialEvent.findUnique({
    where: {
      eventType_sourceType_sourceId: {
        eventType: 'RECONCILIATION_DISCREPANCY',
        sourceType: 'Order',
        sourceId: order.id,
      },
    },
    select: { id: true },
  });
  if (existing) return { status: 'ALREADY_RECORDED' };

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // Phase 2F.1 — the reason string distinguishes which Vendylio state the
  // discrepancy was found in; everything else about the event is identical.
  const reason =
    order.status === 'EXPIRED' ? 'STRIPE_PAID_VENDYLIO_EXPIRED' : 'STRIPE_PAID_VENDYLIO_PENDING';

  await prisma.$transaction(async (tx) => {
    await writeFinancialEventOnce(tx, {
      eventType: 'RECONCILIATION_DISCREPANCY',
      sourceType: 'Order',
      sourceId: order.id,
      storeId: order.storeId,
      orderId: order.id,
      amountCents: order.amount,
      currency: order.currency,
      provider: order.provider,
      externalId: paymentIntentId ?? order.providerChargeId,
      metadata: {
        reason,
        checkoutSessionId: order.providerChargeId,
        paymentIntentId,
        stripePaymentStatus: session.payment_status,
        orderStatus: order.status,
        detectedAt: new Date().toISOString(),
      },
    });
  });

  log.error('reconciliation: Stripe reports paid while the Vendylio Order never was', {
    orderId: order.id,
    providerChargeId: order.providerChargeId,
    orderStatus: order.status,
  });

  return { status: 'DISCREPANCY_RECORDED' };
}

export interface ReconciliationSummary {
  eligibleOrders: number;
  checkedOrders: number;
  paidDiscrepancies: number;
  alreadyRecorded: number;
  stripeErrors: number;
  notFound: number;
  skipped: number;
}

/**
 * Batch runner for the cron. One Order's failure never aborts the rest —
 * each iteration is individually try/caught and only contributes to
 * `skipped` on an unexpected error (never creates a discrepancy merely
 * because something went wrong reading it).
 */
export async function runReconciliation(
  prisma: PrismaClient,
  opts: { now?: Date; batchSize?: number } = {},
): Promise<ReconciliationSummary> {
  const orders = await findEligibleOrders(prisma, opts);
  const summary: ReconciliationSummary = {
    eligibleOrders: orders.length,
    checkedOrders: 0,
    paidDiscrepancies: 0,
    alreadyRecorded: 0,
    stripeErrors: 0,
    notFound: 0,
    skipped: 0,
  };

  for (const order of orders) {
    try {
      const outcome = await reconcileOrder(prisma, order);
      summary.checkedOrders++;
      switch (outcome.status) {
        case 'DISCREPANCY_RECORDED':
          summary.paidDiscrepancies++;
          break;
        case 'ALREADY_RECORDED':
          summary.alreadyRecorded++;
          break;
        case 'NOT_FOUND':
          summary.notFound++;
          break;
        case 'STRIPE_ERROR':
          summary.stripeErrors++;
          break;
        case 'NO_DISCREPANCY':
          break;
      }
    } catch (err) {
      summary.skipped++;
      log.error(
        'reconciliation: unexpected error reconciling an order — skipping, batch continues',
        {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  return summary;
}
