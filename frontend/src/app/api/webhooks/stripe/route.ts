/**
 * POST /api/webhooks/stripe — Stripe payment webhook adapter.
 *
 * Thin shim over the battle-tested factory at `lib/server/webhook/handler.ts`
 * (PROTECTED — never modified). The factory does ALL the hard work: raw-body
 * read via arrayBuffer, HMAC verify, Serializable transaction, WebhookLog
 * upsert + dedup, dispatch, processedAt write-back. This file only wires:
 *   - the Stripe-specific WebhookProvider (signature + payload parser)
 *   - the onPaid handler that verifies Stripe actually collected the exact
 *     amount we priced (payment_status + amount_total gate), then marks the
 *     Order PAID, computes commission, decrements stock, writes the first
 *     OrderStatusEvent (Phase 4 audit trail), and emits outbox events for
 *     the seller notification + buyer confirmation email
 *
 * CLAUDE.md invariants honored here:
 *   - runtime = 'nodejs' is exported below (Buffer/crypto + Prisma — the
 *     runtime-enforcement test fails CI otherwise).
 *   - dynamic = 'force-dynamic' is exported below (prevents accidental POST
 *     caching by Next.js).
 *   - This file NEVER reads the request body. The factory itself reads the
 *     raw bytes for byte-identical HMAC verification — reading the body here
 *     would be a silent HMAC regression.
 *   - Side-effects use enqueueOutbox(tx, ...) INSIDE the same Serializable tx
 *     the factory opens — never via after-commit closures.
 *
 * The actual "mark PAID" side effects (commission, stock decrement, audit
 * trail, Customer upsert, outbox emits) live in
 * lib/server/orders/markPaid.ts — shared with the manual Cash App/Zelle
 * confirmation flow, which has no webhook of its own to call. This file's
 * onPaid only does the Stripe-specific part: find the order by
 * providerChargeId, check it's still PENDING, and confirm Stripe collected
 * the exact amount we priced before handing off to applyOrderPaidEffects.
 *
 * Refunds are NOT handled here yet: Stripe's `charge.refunded` event carries
 * a PaymentIntent id, but `Order.providerChargeId` stores the Checkout
 * Session id — correlating the two would need either a new column or an
 * extra Stripe API call from inside this transaction. Nothing in the app
 * calls `provider.refund()` yet either, so this is deferred rather than
 * built speculatively.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import 'server-only';
import type Stripe from 'stripe';
import { createWebhookHandler } from '@/lib/server/webhook/handler';
import { stripeWebhookProvider } from '@/lib/server/webhook/stripe';
import { applyOrderPaidEffects } from '@/lib/server/orders/markPaid';
import { prisma } from '@/lib/server/prisma';
import { createLogger } from '@/lib/server/logger';

const log = createLogger();

export const POST = createWebhookHandler<Stripe.Event>({
  prisma,
  provider: stripeWebhookProvider,

  async onPaid(event, tx) {
    const session = event.data.object as Stripe.Checkout.Session;
    const order = await tx.order.findFirst({ where: { providerChargeId: session.id } });
    if (!order) return {}; // unknown session — log + drop (no DB row to update)
    if (order.status !== 'PENDING') return {}; // already processed (defense-in-depth alongside WebhookLog dedup)

    // Financial-integrity gate (defense-in-depth). We always create the
    // Checkout Session with `unit_amount = order.amount`, so neither of
    // these can diverge in normal operation — but "the customer reached a
    // completed session" is NOT proof the right amount was actually
    // collected. Refuse to fulfil (leave the order PENDING for the
    // expiration cron) and log loudly rather than shipping goods against a
    // charge that doesn't match what we priced server-side.
    if (session.payment_status && session.payment_status !== 'paid') {
      log.error(
        'stripe webhook: session completed but payment_status is not "paid" — not fulfilling',
        {
          orderId: order.id,
          sessionId: session.id,
          paymentStatus: session.payment_status,
        },
      );
      return {};
    }
    if (typeof session.amount_total === 'number' && session.amount_total !== order.amount) {
      log.error(
        'stripe webhook: session amount_total does not match order.amount — not fulfilling',
        {
          orderId: order.id,
          sessionId: session.id,
          sessionAmountTotal: session.amount_total,
          orderAmount: order.amount,
        },
      );
      return {};
    }

    const paymentMethod = session.payment_method_types?.[0] ?? null;
    await applyOrderPaidEffects(tx, order, { paymentMethod });

    return {};
  },
});
