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
  | EmailOrderNewSellerEvent
  | NotificationOrderUnfulfilledEvent
  | EmailOrderUnfulfilledEvent
  | EmailOrderConfirmationEvent
  | EmailOrderStatusEvent
  | EmailOrderRefundedEvent
  | NotificationDeliveryCompletedEvent
  | NotificationDeliveryFailedEvent
  | NotificationLowStockEvent
  | NotificationOutOfStockEvent;

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
 * NOTIF-01 (Prompt #15) — emitted by markPaid.ts once payment is authoritative,
 * for the STORE OWNER's operational "new order" email (the buyer has their own
 * `email.order_confirmation`). The dispatcher resolves the owner's address +
 * the order details from the order row and honours the owner's
 * NotificationPreferences (`ORDER_PAID` / `email` channel, default-on). A
 * payload for an order whose store/owner vanished is a no-op.
 */
export interface EmailOrderNewSellerEvent {
  kind: 'email.order_new_seller';
  payload: {
    orderId: string;
  };
}

/**
 * ORD-01 (Prompt #15) — emitted by the `order-nudge` cron when a PAID/PREPARING
 * order has gone `ORDER_NUDGE_HOURS` without the seller moving it forward.
 * In-app reminder for the store owner; deduped once-per-order by
 * `createNotification` (dedupeKey `order-unfulfilled:<orderId>`), and the cron
 * also skips orders that already have the notification, so it is never spammy.
 */
export interface NotificationOrderUnfulfilledEvent {
  kind: 'notification.order_unfulfilled';
  payload: {
    userId: string;
    orderId: string;
    hoursWaiting: number;
  };
}

/**
 * ORD-01 (Prompt #15) — the email sibling of `notification.order_unfulfilled`,
 * emitted by the same cron. Recipient + order details resolved from the order
 * row; honours the owner's NotificationPreferences (`ORDER_UNFULFILLED` /
 * `email` channel, default-on).
 */
export interface EmailOrderUnfulfilledEvent {
  kind: 'email.order_unfulfilled';
  payload: {
    orderId: string;
    hoursWaiting: number;
  };
}

/**
 * Phase 2/7 — emitted by markPaid.ts once payment is authoritative, for the
 * guest buyer's confirmation email. The dispatcher resolves the recipient +
 * the branded template data from the order row (never trusts a payload-
 * supplied address — §118); a payload without `customerEmail` on the order is
 * a no-op. Legacy rows may still carry `to`/`amount`/`currency` — ignored.
 */
export interface EmailOrderConfirmationEvent {
  kind: 'email.order_confirmation';
  payload: {
    orderId: string;
  };
}

/**
 * Phase 7 — emitted by the seller status routes (api/orders/[id]/route.ts,
 * api/orders/[id]/delivery/route.ts) and the Uber Direct webhook, for the
 * per-milestone customer status emails ("being prepared", "on the way",
 * "delivered", delivery issue). `kind` selects the template copy. The
 * dispatcher resolves recipient + template data from the order row.
 */
export interface EmailOrderStatusEvent {
  kind: 'email.order_status';
  payload: {
    orderId: string;
    kind: 'PREPARING' | 'READY' | 'ON_THE_WAY' | 'DELIVERED' | 'CANCELLED' | 'DELIVERY_ISSUE';
  };
}

/**
 * Phase 7 — emitted by POST /api/orders/[id]/refund. Dispatcher resolves
 * recipient + template data from the order row.
 */
export interface EmailOrderRefundedEvent {
  kind: 'email.order_refunded';
  payload: {
    orderId: string;
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

/**
 * Phase 4 — emitted by markPaid.ts when a paid sale drops a product/variant
 * to or below its low-stock threshold, and by the low-stock-sweep cron as a
 * safety net. Targets the store owner. The dispatcher routes it through
 * `createNotification` and stamps `Product/ProductVariant.lowStockNotifiedAt`.
 * `detectedAt` is fixed at enqueue time so the dedupeKey is stable across
 * dispatch retries (see notifications/templates.ts::lowStockNotification).
 */
export interface NotificationLowStockEvent {
  kind: 'notification.low_stock';
  payload: {
    userId: string;
    productId: string;
    variantId: string | null;
    productName: string;
    variantLabel: string | null;
    quantity: number;
    threshold: number;
    detectedAt: string;
  };
}

/**
 * Phase 4 — same emit sites as NotificationLowStockEvent, for the
 * quantity-hits-zero case.
 */
export interface NotificationOutOfStockEvent {
  kind: 'notification.out_of_stock';
  payload: {
    userId: string;
    productId: string;
    variantId: string | null;
    productName: string;
    variantLabel: string | null;
    detectedAt: string;
  };
}

export type OutboxEventKind = OutboxEvent['kind'];
