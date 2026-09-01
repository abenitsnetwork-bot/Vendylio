/**
 * Notification templates.
 *
 * Each project defines its own typed wrappers around `createNotification`.
 * The example below ships with the template — adapt it, replace it, or add
 * more (e.g. `firePaymentReceived`, `fireExportReady`). The pattern:
 *
 *   1. Build a `CreateNotificationInput` with a *deterministic* dedupeKey
 *      so the unique constraint enforces at-most-once delivery for that
 *      logical event (e.g. `payment-received:${orderId}` — never include
 *      a timestamp or random suffix).
 *   2. Pass the input + your PrismaClient to `createNotification`.
 *   3. Optionally enqueue an email via `EmailQueue.enqueue` — but ONLY
 *      after the notification row is created, so a duplicate event never
 *      sends a duplicate email.
 *
 * Keep these helpers free of side effects beyond the row insert; the
 * email enqueue belongs at the call site so each project can pick the
 * right channel (no email vs. transactional vs. marketing).
 */

import type { CreateNotificationInput } from './index';

export function welcomeNotification(userId: string, email: string): CreateNotificationInput {
  return {
    userId,
    type: 'WELCOME',
    title: 'Welcome!',
    body: `Glad to have you on board, ${email}.`,
    dedupeKey: `welcome:${userId}`,
  };
}

/**
 * Phase 2 — notifies the store owner (not the buyer) after a Stripe
 * checkout completes. Dispatched from the Stripe webhook's onPaid handler
 * via the outbox.
 */
export function orderPaid(
  userId: string,
  orderId: string,
  amount: number,
  currency: string,
  /** Phase 7 — human "VND-…" reference; falls back to the raw id. */
  reference?: string,
): CreateNotificationInput {
  const ref = reference ?? orderId;
  return {
    userId,
    type: 'ORDER_PAID',
    title: 'New order paid',
    body: `Order ${ref} for ${(amount / 100).toFixed(2)} ${currency} was just paid.`,
    data: { orderId, amount, currency },
    dedupeKey: `order-paid:${orderId}`,
  };
}

/**
 * ORD-01 (Prompt #15) — nudges the store owner when a paid order has gone
 * `ORDER_NUDGE_HOURS` without being moved forward (still PAID or PREPARING).
 * dedupeKey has NO time bucket: at most one nudge per order, ever — the
 * `order-nudge` cron also pre-filters orders that already have this
 * notification, so it is never spammy.
 */
export function orderUnfulfilled(
  userId: string,
  orderId: string,
  hoursWaiting: number,
  reference?: string,
): CreateNotificationInput {
  const ref = reference ?? orderId;
  return {
    userId,
    type: 'ORDER_UNFULFILLED',
    title: 'An order is still waiting',
    body: `Order ${ref} was paid about ${hoursWaiting}h ago and hasn't moved forward. Mark it as preparing so the customer sees progress.`,
    data: { orderId, hoursWaiting },
    dedupeKey: `order-unfulfilled:${orderId}`,
  };
}

/**
 * Uber Direct — notifies the store owner once a courier confirms drop-off.
 * Dispatched from the Uber Direct webhook via the outbox.
 */
export function deliveryCompleted(userId: string, orderId: string): CreateNotificationInput {
  return {
    userId,
    type: 'DELIVERY_COMPLETED',
    title: 'Delivery completed',
    body: `Order ${orderId} was delivered by the courier.`,
    data: { orderId },
    dedupeKey: `delivery-completed:${orderId}`,
  };
}

/**
 * Uber Direct — notifies the store owner when the courier cancels or
 * returns a delivery, so the seller can follow up with the buyer. Does not
 * imply the order itself was cancelled — the order is moved back to READY
 * (see api/webhooks/uber-direct/route.ts's onFailed) so "Request Delivery"
 * is immediately clickable again.
 */
export function deliveryFailed(
  userId: string,
  orderId: string,
  status: string,
  /** Phase 7 — human "VND-…" reference; falls back to the raw id. */
  reference?: string,
): CreateNotificationInput {
  const ref = reference ?? orderId;
  return {
    userId,
    type: 'DELIVERY_FAILED',
    title: 'Delivery needs attention',
    body: `Order ${ref}'s Uber Direct delivery was ${status}. The order is back to Ready — request delivery again once you've checked in with the customer.`,
    data: { orderId, status },
    dedupeKey: `delivery-failed:${orderId}:${status}`,
  };
}

/**
 * Prompt #12 — notifies the store owner once a courier delivery has been
 * successfully requested (the courier is on the way to pick up). Emitted by
 * the fulfillment-tick cron / the seller's "Request delivery" click.
 */
export function fulfillmentDispatched(
  userId: string,
  orderId: string,
  providerName: string,
  reference?: string,
): CreateNotificationInput {
  const ref = reference ?? orderId;
  return {
    userId,
    type: 'FULFILLMENT_DISPATCHED',
    title: 'Courier requested',
    body: `A ${providerName} courier has been requested for order ${ref}.`,
    data: { orderId, providerName },
    dedupeKey: `fulfillment-dispatched:${orderId}`,
  };
}

/**
 * Prompt #12 — notifies the store owner when the engine could not arrange a
 * courier after all retries. The order stays PAID; the seller retries from the
 * order detail page once the underlying issue is fixed. Distinct from
 * `deliveryFailed` (a courier that WAS assigned then cancelled/returned).
 */
export function fulfillmentSetupFailed(
  userId: string,
  orderId: string,
  reason: string,
  reference?: string,
): CreateNotificationInput {
  const ref = reference ?? orderId;
  return {
    userId,
    type: 'FULFILLMENT_FAILED',
    title: 'Delivery setup needs attention',
    body: `We couldn't arrange a courier for order ${ref} (${reason}). The order is paid — retry delivery from the order page once you're ready.`,
    data: { orderId, reason },
    dedupeKey: `fulfillment-failed:${orderId}`,
  };
}

/**
 * Phase 4 — notifies the store owner when a product/variant drops to or
 * below its effective low-stock threshold (but is not yet out). Emitted
 * from markPaid.ts (on the crossing decrement) and the low-stock-sweep
 * cron (safety net for manual adjustments). `detectedAt` (an ISO date-time
 * fixed at enqueue time) is truncated to a day and folded into the
 * dedupeKey so the same low-stock episode dedupes across dispatch retries,
 * but a *new* episode after a restock-then-drop can alert again.
 */
export function lowStockNotification(
  userId: string,
  args: {
    productId: string;
    variantId: string | null;
    productName: string;
    variantLabel: string | null;
    quantity: number;
    threshold: number;
    detectedAt: string;
  },
): CreateNotificationInput {
  const label = args.variantLabel ? `${args.productName} (${args.variantLabel})` : args.productName;
  const day = args.detectedAt.slice(0, 10);
  return {
    userId,
    type: 'LOW_STOCK',
    title: 'Low stock',
    body: `${label} is down to ${args.quantity} — at or below your alert threshold of ${args.threshold}. Restock soon.`,
    data: {
      productId: args.productId,
      variantId: args.variantId,
      quantity: args.quantity,
      threshold: args.threshold,
    },
    dedupeKey: `low-stock:${args.productId}:${args.variantId ?? 'base'}:${day}`,
  };
}

/**
 * Phase 4 — notifies the store owner when a product/variant hits zero (or
 * below). Same emit sites and dedupe strategy as `lowStockNotification`.
 */
export function outOfStockNotification(
  userId: string,
  args: {
    productId: string;
    variantId: string | null;
    productName: string;
    variantLabel: string | null;
    detectedAt: string;
  },
): CreateNotificationInput {
  const label = args.variantLabel ? `${args.productName} (${args.variantLabel})` : args.productName;
  const day = args.detectedAt.slice(0, 10);
  return {
    userId,
    type: 'OUT_OF_STOCK',
    title: 'Out of stock',
    body: `${label} is out of stock. Buyers can no longer order it until you restock.`,
    data: { productId: args.productId, variantId: args.variantId },
    dedupeKey: `out-of-stock:${args.productId}:${args.variantId ?? 'base'}:${day}`,
  };
}
