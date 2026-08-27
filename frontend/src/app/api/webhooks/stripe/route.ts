/**
 * POST /api/webhooks/stripe — Stripe payment webhook adapter.
 *
 * Thin shim over the battle-tested factory at `lib/server/webhook/handler.ts`
 * (PROTECTED — never modified). The factory does ALL the hard work: raw-body
 * read via arrayBuffer, HMAC verify, Serializable transaction, WebhookLog
 * upsert + dedup, dispatch, processedAt write-back. This file only wires:
 *   - the Stripe-specific WebhookProvider (signature + payload parser)
 *   - the onPaid handler that marks the Order PAID, computes commission,
 *     decrements stock, writes the first OrderStatusEvent (Phase 4 audit
 *     trail), and emits outbox events for the seller notification + buyer
 *     confirmation email
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
 * providerChargeId and check it's still PENDING.
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

export const POST = createWebhookHandler<Stripe.Event>({
  prisma,
  provider: stripeWebhookProvider,

  async onPaid(event, tx) {
    const session = event.data.object as Stripe.Checkout.Session;
    const order = await tx.order.findFirst({ where: { providerChargeId: session.id } });
    if (!order) return {}; // unknown session — log + drop (no DB row to update)
    if (order.status !== 'PENDING') return {}; // already processed (defense-in-depth alongside WebhookLog dedup)

    const paymentMethod = session.payment_method_types?.[0] ?? null;
    await applyOrderPaidEffects(tx, order, { paymentMethod });

    return {};
  },
});
