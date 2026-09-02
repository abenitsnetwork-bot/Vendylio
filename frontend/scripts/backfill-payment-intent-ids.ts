/**
 * One-off backfill of `Order.stripePaymentIntentId` for card orders that were
 * paid BEFORE the column existed (migration
 * 20260902195131_order_stripe_payment_intent_id).
 *
 * The `charge.refunded` webhook (api/webhooks/stripe/route.ts onRefunded)
 * matches an order by its PaymentIntent id. New orders capture it in `onPaid`;
 * this fills the gap for old ones by asking Stripe for the PaymentIntent of
 * each order's Checkout Session (`providerChargeId`, a `cs_…`).
 *
 *   Dry run (default — counts, changes nothing):
 *     pnpm --filter frontend exec tsx --env-file-if-exists=.env \
 *       --env-file-if-exists=.env.local scripts/backfill-payment-intent-ids.ts
 *
 *   Apply:
 *     RUN_BACKFILL=1 pnpm --filter frontend exec tsx … scripts/backfill-payment-intent-ids.ts
 *
 * Safe to re-run: only touches rows where stripePaymentIntentId IS NULL.
 * Aborts on NODE_ENV=production unless RUN_BACKFILL=1 is explicitly set.
 */
import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const APPLY = process.env.RUN_BACKFILL === '1';
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-07-29.dahlia';
const CARD_PROVIDERS = ['stripe_platform', 'stripe_connect'];

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not set — cannot reach Stripe.');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && !APPLY) {
    console.error('Refusing to run against NODE_ENV=production without RUN_BACKFILL=1.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });

  try {
    const orders = await prisma.order.findMany({
      where: {
        provider: { in: CARD_PROVIDERS },
        stripePaymentIntentId: null,
        providerChargeId: { not: null },
      },
      select: { id: true, providerChargeId: true },
    });

    console.log(
      `${orders.length} card order(s) with a Checkout Session id and no PaymentIntent id.`,
    );
    if (orders.length === 0) return;
    if (!APPLY) {
      console.log('Dry run — set RUN_BACKFILL=1 to write. Nothing changed.');
      return;
    }

    let filled = 0;
    let skipped = 0;
    for (const order of orders) {
      const sessionId = order.providerChargeId!;
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const pi =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : (session.payment_intent?.id ?? null);
        if (!pi) {
          console.warn(`  ${order.id}: session ${sessionId} has no payment_intent — skipped`);
          skipped += 1;
          continue;
        }
        await prisma.order.update({
          where: { id: order.id },
          data: { stripePaymentIntentId: pi },
        });
        filled += 1;
      } catch (err) {
        console.warn(`  ${order.id}: ${sessionId} — ${String(err)}`);
        skipped += 1;
      }
    }
    console.log(`Done. ${filled} filled, ${skipped} skipped.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
