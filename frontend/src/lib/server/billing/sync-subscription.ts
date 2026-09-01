// Phase 1a — reconcile a Store's plan with the state of its Stripe
// subscription. Called from the stripe-billing webhook (inside the factory's
// Serializable tx) and safe to call again for the same event (idempotent —
// it writes the same derived state every time).
//
// `Store.plan` is the value the rest of the app reads; the rule is:
//   subscription active / trialing  → plan PRO,  planSource SUBSCRIPTION
//   subscription past_due           → plan UNCHANGED (grace until period end;
//                                     the daily sweep retires it if the
//                                     period end passes while still past_due)
//   subscription canceled / unpaid  → if planSource was SUBSCRIPTION, plan FREE
//
// A COMP store (pilot, planSource='COMP') is never touched here — it has no
// subscription. If a comped merchant later subscribes for real, the first
// subscription event flips planSource to SUBSCRIPTION.
import 'server-only';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';

export type SubStatus = 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED';

/** Minimal shape we need off a Stripe.Subscription — keeps this testable. */
export interface SubscriptionInput {
  id: string;
  customerId: string;
  /** Raw Stripe status string. */
  status: string;
  /** Unix seconds; null when Stripe omits it. */
  currentPeriodEnd: number | null;
  /** subscription.metadata.storeId, when set at Checkout. */
  storeId: string | null;
}

const ACTIVE_STATES = new Set(['active', 'trialing']);
const DEAD_STATES = new Set(['canceled', 'unpaid', 'incomplete_expired']);

function mapStatus(raw: string): SubStatus {
  if (raw === 'trialing') return 'TRIALING';
  if (raw === 'past_due') return 'PAST_DUE';
  if (DEAD_STATES.has(raw)) return 'CANCELED';
  return 'ACTIVE';
}

async function findStore(
  tx: PrismaTransactionClient,
  sub: SubscriptionInput,
): Promise<{ id: string; plan: string; planSource: string | null } | null> {
  const select = { id: true, plan: true, planSource: true } as const;
  if (sub.storeId) {
    const byId = await tx.store.findUnique({ where: { id: sub.storeId }, select });
    if (byId) return byId;
  }
  const bySub = await tx.store.findUnique({
    where: { stripeSubscriptionId: sub.id },
    select,
  });
  if (bySub) return bySub;
  return tx.store.findUnique({ where: { stripeCustomerId: sub.customerId }, select });
}

export async function syncSubscriptionFromStripe(
  tx: PrismaTransactionClient,
  sub: SubscriptionInput,
): Promise<{ storeId: string; plan: string } | null> {
  const store = await findStore(tx, sub);
  if (!store) return null;

  const status = mapStatus(sub.status);
  const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd * 1000) : null;

  const data: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    subscriptionStatus: SubStatus;
    subscriptionCurrentPeriodEnd: Date | null;
    plan?: string;
    planSource?: string | null;
  } = {
    stripeCustomerId: sub.customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: status,
    subscriptionCurrentPeriodEnd: periodEnd,
  };

  if (ACTIVE_STATES.has(sub.status)) {
    data.plan = 'PRO';
    data.planSource = 'SUBSCRIPTION';
  } else if (status === 'CANCELED' && store.planSource === 'SUBSCRIPTION') {
    data.plan = 'FREE';
    data.planSource = null;
  }
  // PAST_DUE: record the status, leave plan/planSource — grace until the
  // period end, then plan-downgrade-sweep retires it.

  await tx.store.update({ where: { id: store.id }, data });
  return { storeId: store.id, plan: data.plan ?? store.plan };
}

/**
 * `invoice.payment_failed` carries an Invoice, not a Subscription. Stripe
 * also transitions the subscription to `past_due` (→ a
 * `customer.subscription.updated` we handle above), but recording it here
 * too means a merchant whose subscription webhook is delayed still shows the
 * right status. Never downgrades — that's the sweep's job.
 */
export async function markSubscriptionPastDue(
  tx: PrismaTransactionClient,
  customerId: string,
): Promise<void> {
  const store = await tx.store.findUnique({
    where: { stripeCustomerId: customerId },
    select: { id: true, planSource: true },
  });
  if (!store || store.planSource !== 'SUBSCRIPTION') return;
  await tx.store.update({
    where: { id: store.id },
    data: { subscriptionStatus: 'PAST_DUE' },
  });
}
