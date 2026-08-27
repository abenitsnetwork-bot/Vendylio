/**
 * Outbox event types. Add new variants here, then handle them in
 * backend/src/lib/outbox/dispatcher.ts.
 *
 * `kind` is a dotted "domain.event" string. The dispatcher looks up the
 * handler by exact match — no inheritance, no fallback dispatching.
 *
 * Each variant carries its own `payload` shape; runtime validation
 * happens in the dispatcher (the JSON column is opaque to Prisma).
 */

export type OutboxEvent =
  | EmailVerificationCodeEvent
  | EmailPasswordResetEvent
  | NotificationOrderPaidEvent
  | EmailOrderConfirmationEvent
  | EmailOrderRefundedEvent
  | NotificationDeliveryCompletedEvent
  | NotificationDeliveryFailedEvent;

/**
 * Phase 1 — emitted by signup + resend-verification routes; consumed by the
 * email-queue cron in Phase 5 (which calls verificationEmail() to render).
 */
export interface EmailVerificationCodeEvent {
  kind: 'email.verification_code';
  payload: {
    to: string;
    code: string;
    expiresAt: string;
  };
}

/**
 * Phase 1 — emitted by forgot-password route; consumed by the email-queue cron
 * in Phase 5 (which calls resetPasswordEmail() to render).
 */
export interface EmailPasswordResetEvent {
  kind: 'email.password_reset';
  payload: {
    to: string;
    code: string;
    expiresAt: string;
  };
}

/**
 * Phase 2 — emitted by the Stripe webhook's onPaid handler, targeting the
 * store owner (not the buyer). Consumed by the outbox dispatcher, which
 * routes it through `createNotification` (CLAUDE.md: never
 * `prisma.notification.create` directly).
 */
export interface NotificationOrderPaidEvent {
  kind: 'notification.order_paid';
  payload: {
    userId: string;
    orderId: string;
    amount: number;
    currency: string;
  };
}

/**
 * Phase 2 — emitted by the Stripe webhook's onPaid handler, targeting the
 * guest buyer's `customerEmail` (skipped if the buyer didn't provide one).
 */
export interface EmailOrderConfirmationEvent {
  kind: 'email.order_confirmation';
  payload: {
    to: string;
    orderId: string;
    amount: number;
    currency: string;
  };
}

/**
 * Phase 7 — emitted by POST /api/orders/[id]/refund, addressed to the guest
 * buyer's `customerEmail` (skipped if the buyer didn't provide one).
 */
export interface EmailOrderRefundedEvent {
  kind: 'email.order_refunded';
  payload: {
    to: string;
    orderId: string;
    amount: number;
    currency: string;
  };
}

/**
 * Uber Direct — emitted by the Uber Direct webhook's onPaid handler (the
 * "paid" slot reused for "delivery completed" since the generic webhook
 * factory has no dedicated slot for it — same precedent as Stripe Connect's
 * account.updated handler).
 */
export interface NotificationDeliveryCompletedEvent {
  kind: 'notification.delivery_completed';
  payload: {
    userId: string;
    orderId: string;
  };
}

/**
 * Uber Direct — emitted by the webhook's onFailed handler when the courier
 * cancels or returns a delivery. Deliberately does NOT cancel the Order
 * itself (a courier cancellation isn't proof the sale should be voided) —
 * this just alerts the seller to follow up manually.
 */
export interface NotificationDeliveryFailedEvent {
  kind: 'notification.delivery_failed';
  payload: {
    userId: string;
    orderId: string;
    status: string;
  };
}

export type OutboxEventKind = OutboxEvent['kind'];
