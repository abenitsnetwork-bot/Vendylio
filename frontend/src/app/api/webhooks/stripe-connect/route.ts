/**
 * POST /api/webhooks/stripe-connect — Stripe Connect account lifecycle
 * webhook (Phase 3). Configure this as a separate endpoint in the Stripe
 * dashboard's Connect webhook settings (its own signing secret,
 * STRIPE_CONNECT_WEBHOOK_SECRET), listening for `account.updated`.
 *
 * Thin shim over the same battle-tested factory as the platform payment
 * webhook (lib/server/webhook/handler.ts — PROTECTED). See
 * webhook/stripe-connect.ts for why `account.updated` is wired through
 * `onPaid` despite the name — the factory's kind vocabulary has no
 * "account lifecycle" bucket. Phase 2 adds `transfer.reversed` → `onFailed`
 * (a BANK payout bounced back to the platform).
 *
 * Subscribe this Connect endpoint to: account.updated, transfer.reversed.
 *
 * Status transition rule (deliberately conservative):
 *   - charges_enabled && payouts_enabled  → ACTIVE
 *   - previously ACTIVE but a capability is now missing → RESTRICTED
 *     (Stripe flagged the account after it was already taking real charges)
 *   - otherwise (still mid-onboarding, PENDING/NOT_STARTED) → unchanged.
 *     `account.updated` fires repeatedly *during* onboarding, before
 *     capabilities are enabled — treating every such event as RESTRICTED
 *     would wrongly flip a store that simply hasn't finished onboarding yet.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import 'server-only';
import type Stripe from 'stripe';
import { createWebhookHandler } from '@/lib/server/webhook/handler';
import { stripeConnectWebhookProvider } from '@/lib/server/webhook/stripe-connect';
import { prisma } from '@/lib/server/prisma';
import { createLogger } from '@/lib/server/logger';

const log = createLogger();

export const POST = createWebhookHandler<Stripe.Event>({
  prisma,
  provider: stripeConnectWebhookProvider,

  async onPaid(event, tx) {
    const account = event.data.object as Stripe.Account;
    const accountId = event.account ?? account.id;
    if (!accountId) return {};

    const store = await tx.store.findUnique({ where: { stripeAccountId: accountId } });
    if (!store) return {}; // unknown account — log + drop (no DB row to update)

    const chargesEnabled = account.charges_enabled ?? false;
    const payoutsEnabled = account.payouts_enabled ?? false;

    let nextStatus = store.stripeOnboardingStatus;
    if (chargesEnabled && payoutsEnabled) {
      nextStatus = 'ACTIVE';
    } else if (store.stripeOnboardingStatus === 'ACTIVE') {
      nextStatus = 'RESTRICTED';
    }

    if (nextStatus !== store.stripeOnboardingStatus) {
      await tx.store.update({
        where: { id: store.id },
        data: { stripeOnboardingStatus: nextStatus },
      });
    }

    return {};
  },

  // Phase 2 — `transfer.reversed`: a BANK payout we already marked COMPLETED
  // bounced back to the platform balance. Flip the withdrawal to FAILED so the
  // seller's balance is released and an operator can retry / pay another way.
  async onFailed(event, tx) {
    if (event.type !== 'transfer.reversed') return {};
    const transfer = event.data.object as Stripe.Transfer;
    const w = await tx.withdrawal.findUnique({
      where: { providerPayoutId: transfer.id },
      select: { id: true, status: true },
    });
    if (!w) {
      log.warn('stripe-connect webhook: transfer.reversed for unknown withdrawal', {
        transferId: transfer.id,
      });
      return {};
    }
    if (w.status === 'FAILED') return {};
    await tx.withdrawal.update({
      where: { id: w.id },
      data: {
        status: 'FAILED',
        failureReason: 'Stripe transfer reversed',
        completedAt: new Date(),
      },
    });
    return {};
  },
});
