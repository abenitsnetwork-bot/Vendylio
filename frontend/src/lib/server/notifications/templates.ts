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
): CreateNotificationInput {
  return {
    userId,
    type: 'ORDER_PAID',
    title: 'New order paid',
    body: `Order ${orderId} for ${(amount / 100).toFixed(2)} ${currency} was just paid.`,
    data: { orderId, amount, currency },
    dedupeKey: `order-paid:${orderId}`,
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
 * imply the order itself was cancelled.
 */
export function deliveryFailed(
  userId: string,
  orderId: string,
  status: string,
): CreateNotificationInput {
  return {
    userId,
    type: 'DELIVERY_FAILED',
    title: 'Delivery needs attention',
    body: `Order ${orderId}'s Uber Direct delivery was ${status} — follow up with the customer.`,
    data: { orderId, status },
    dedupeKey: `delivery-failed:${orderId}:${status}`,
  };
}
