/**
 * POST /api/webhooks/stripe-billing — Vendylio Pro subscription webhook.
 *
 * Configure as a SEPARATE endpoint in the Stripe dashboard with its own
 * signing secret (STRIPE_BILLING_WEBHOOK_SECRET), subscribed to:
 *   customer.subscription.created / updated / deleted
 *   invoice.payment_failed
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
  };
}

export const POST = createWebhookHandler<Stripe.Event>({
  prisma,
  provider: stripeBillingWebhookProvider,

  // customer.subscription.created / updated
  async onPaid(event, tx) {
    if (!event.type.startsWith('customer.subscription.')) return {};
    const sub = event.data.object as Stripe.Subscription;
    const result = await syncSubscriptionFromStripe(tx, toSubscriptionInput(sub));
    if (!result) {
      log.warn('stripe-billing webhook: no store matched subscription', {
        subscriptionId: sub.id,
        eventType: event.type,
      });
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
