/**
 * POST /api/webhooks/stripe-billing — Vendylio Pro subscription webhook.
 *
 * Configure as a SEPARATE endpoint in the Stripe dashboard with its own
 * signing secret (STRIPE_BILLING_WEBHOOK_SECRET), subscribed to:
 *   customer.subscription.created / updated / deleted
 *   invoice.paid / invoice.payment_failed
 *   checkout.session.completed        (Phase 1b — card setup for commission)
 *
 * Thin shim over the battle-tested factory (lib/server/webhook/handler.ts —
 * PROTECTED): raw-body HMAC, Serializable tx, WebhookLog dedup, processedAt
 * write-back all come for free. This file only maps the event to a plan
 * change via syncSubscriptionFromStripe / markSubscriptionPastDue.
 *
 * CLAUDE.md invariants: runtime='nodejs', dynamic='force-dynamic', never
 * reads the request body (the factory does, for byte-identical HMAC).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import 'server-only';
import type Stripe from 'stripe';
import { createWebhookHandler } from '@/lib/server/webhook/handler';
import { stripeBillingWebhookProvider } from '@/lib/server/webhook/stripe-billing';
import {
  syncSubscriptionFromStripe,
  markSubscriptionPastDue,
  type SubscriptionInput,
} from '@/lib/server/billing/sync-subscription';
import { settleInvoicedCommission } from '@/lib/server/billing/commission-settlement';
import { promoteSetupIntentCard } from '@/lib/server/billing/stripe-billing';
import { prisma } from '@/lib/server/prisma';
import { createLogger } from '@/lib/server/logger';

const log = createLogger();

function customerId(v: string | { id: string } | null): string {
  if (!v) return '';
  return typeof v === 'string' ? v : v.id;
}

/** Normalise a Stripe.Subscription to the shape sync-subscription needs.
 *  `current_period_end` moved to the item level in recent API versions, so
 *  fall back to the first item when the top-level field is absent. */
function toSubscriptionInput(sub: Stripe.Subscription): SubscriptionInput {
  const topLevelEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  const itemEnd = sub.items?.data?.[0]?.current_period_end;
  return {
    id: sub.id,
    customerId: customerId(sub.customer as string | { id: string } | null),
    status: sub.status,
    currentPeriodEnd: topLevelEnd ?? itemEnd ?? null,
    storeId: sub.metadata?.storeId ?? null,
    interval: sub.items?.data?.[0]?.price?.recurring?.interval ?? null,
  };
}

export const POST = createWebhookHandler<Stripe.Event>({
  prisma,
  provider: stripeBillingWebhookProvider,

  // customer.subscription.created / updated | invoice.paid |
  // checkout.session.completed
  async onPaid(event, tx) {
    if (event.type.startsWith('customer.subscription.')) {
      const sub = event.data.object as Stripe.Subscription;
      const result = await syncSubscriptionFromStripe(tx, toSubscriptionInput(sub));
      if (!result) {
        log.warn('stripe-billing webhook: no store matched subscription', {
          subscriptionId: sub.id,
          eventType: event.type,
        });
      }
      return {};
    }

    // Phase 1b — a commission-settlement invoice was paid. Flip the INVOICED
    // CommissionCharge rows it covers to SETTLED. A no-op for subscription
    // renewal invoices (no rows carry their id).
    if (event.type === 'invoice.paid') {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.id) {
        const settled = await settleInvoicedCommission(tx, invoice.id);
        if (settled > 0) {
          log.info('stripe-billing webhook: commission invoice settled', {
            invoiceId: invoice.id,
            chargesSettled: settled,
          });
        }
      }
      return {};
    }

    // Phase 1b — a `mode: 'setup'` Checkout completed: promote the collected
    // card to the customer's invoice default (outside the tx — a Stripe API
    // call, idempotent, never blocks the webhook ack).
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'setup' && typeof session.setup_intent === 'string') {
        try {
          await promoteSetupIntentCard(session.setup_intent);
        } catch (err) {
          log.warn('stripe-billing webhook: could not promote setup-intent card', {
            sessionId: session.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return {};
    }

    return {};
  },

  // customer.subscription.deleted | invoice.payment_failed
  async onFailed(event, tx) {
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscriptionFromStripe(tx, toSubscriptionInput(sub));
      return {};
    }
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice;
      const cid = customerId(invoice.customer as string | { id: string } | null);
      if (cid) await markSubscriptionPastDue(tx, cid);
      return {};
    }
    return {};
  },
});
