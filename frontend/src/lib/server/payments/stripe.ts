/**
 * Stripe provider — platform-account Checkout (Phase 2) + destination
 * charges for connected sellers (Phase 3). Implements `PaymentProvider`
 * from `./provider.ts`; the orders/webhook routes consume that interface,
 * never this file directly (see provider-singleton.ts). `chargeConnected`
 * is Stripe-specific (destination charges aren't a concept every provider
 * shares) so it lives on `StripeProviderHandle`, not the generic interface —
 * the *routing decision* between `charge` and `chargeConnected` belongs to
 * the checkout route (based on Store.stripeOnboardingStatus), not here.
 */
import 'server-only';
import Stripe from 'stripe';
import type { WebhookProvider, ParsedIds } from '../webhook/handler';
import type {
  PaymentProvider,
  ChargeInput,
  ChargeResult,
  RefundInput,
  RefundResult,
} from './provider';

// Stripe rolls out breaking changes via dated, opt-in API versions. Pinning
// explicitly means an account-level default change on Stripe's side never
// silently alters behavior here. Bump deliberately (and re-run the test
// suite) when upgrading the `stripe` package.
export const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-07-29.dahlia';

export interface StripeEnv {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

export interface ChargeConnectedInput extends ChargeInput {
  /** The seller's connected Stripe account id (Store.stripeAccountId). */
  destinationAccountId: string;
  /** Platform commission, smallest currency unit — deducted before the transfer. */
  applicationFeeAmount: number;
}

export interface StripeProviderHandle extends PaymentProvider {
  webhookProvider: WebhookProvider<Stripe.Event>;
  /** Destination charge — Stripe Connect (Phase 3). Money lands directly on
   * the seller's connected account, minus `applicationFeeAmount`. Stripe's
   * own processing fee is deducted from the connected account by default
   * (standard destination-charge behavior — the seller absorbs card fees,
   * same as most marketplaces). */
  chargeConnected(input: ChargeConnectedInput): Promise<ChargeResult>;
}

function stripeErrorMessage(err: unknown): string {
  return err instanceof Stripe.errors.StripeError ? err.message : String(err);
}

export function createStripeProvider(env: StripeEnv): StripeProviderHandle {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('createStripeProvider: STRIPE_SECRET_KEY is required');
  }
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('createStripeProvider: STRIPE_WEBHOOK_SECRET is required');
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
  });

  // ── charge — hosted Checkout Session, single line item for the order total.
  // Vendylio's cart already itemizes on `Order.lineItems`; Stripe only needs
  // the grand total to charge, so we don't replicate the cart line-by-line
  // into Stripe's own line_items (keeps this adapter honest to the generic
  // `ChargeInput` shape instead of smuggling app data through it).
  async function charge(input: ChargeInput): Promise<ChargeResult> {
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        client_reference_id: input.externalRef,
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amount,
              product_data: { name: `Order ${input.externalRef}` },
            },
            quantity: 1,
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.failureUrl,
        ...(input.customer.email ? { customer_email: input.customer.email } : {}),
      });
    } catch (err) {
      throw new Error(`Stripe checkout session creation failed: ${stripeErrorMessage(err)}`);
    }

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return {
      providerChargeId: session.id,
      paymentUrl: session.url,
      status: 'PENDING',
    };
  }

  // ── chargeConnected — same hosted Checkout Session, routed as a
  // destination charge: the seller's connected account receives the funds
  // (minus applicationFeeAmount, Stripe's platform-fee mechanism) instead of
  // the platform account. `Order.provider = 'stripe_connect'` at the call
  // site distinguishes these for the withdrawal-balance filter (Phase 3
  // security requirement — a connected seller must not also be able to
  // withdraw the same sale manually).
  async function chargeConnected(input: ChargeConnectedInput): Promise<ChargeResult> {
    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        client_reference_id: input.externalRef,
        line_items: [
          {
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amount,
              product_data: { name: `Order ${input.externalRef}` },
            },
            quantity: 1,
          },
        ],
        success_url: input.successUrl,
        cancel_url: input.failureUrl,
        ...(input.customer.email ? { customer_email: input.customer.email } : {}),
        payment_intent_data: {
          application_fee_amount: input.applicationFeeAmount,
          transfer_data: { destination: input.destinationAccountId },
        },
      });
    } catch (err) {
      throw new Error(
        `Stripe destination-charge session creation failed: ${stripeErrorMessage(err)}`,
      );
    }

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL');
    }

    return {
      providerChargeId: session.id,
      paymentUrl: session.url,
      status: 'PENDING',
    };
  }

  // ── refund — accepts either a Checkout Session id (what we store as
  // Order.providerChargeId) or a PaymentIntent id directly; Stripe's refund
  // API only understands the latter, so a Session id is resolved first.
  async function refund(input: RefundInput): Promise<RefundResult> {
    let paymentIntentId = input.providerChargeId;
    if (paymentIntentId.startsWith('cs_')) {
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.retrieve(paymentIntentId);
      } catch (err) {
        throw new Error(`Stripe session lookup failed: ${stripeErrorMessage(err)}`);
      }
      const pi = session.payment_intent;
      const resolved = typeof pi === 'string' ? pi : pi?.id;
      if (!resolved) {
        throw new Error('Stripe Checkout Session has no PaymentIntent to refund');
      }
      paymentIntentId = resolved;
    }

    try {
      const refundObj = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
      });
      const status: RefundResult['status'] =
        refundObj.status === 'succeeded'
          ? 'COMPLETED'
          : refundObj.status === 'failed'
            ? 'FAILED'
            : 'PENDING';
      return { providerRefundId: refundObj.id, status };
    } catch (err) {
      throw new Error(`Stripe refund failed: ${stripeErrorMessage(err)}`);
    }
  }

  // ── webhook provider ────────────────────────────────────────────────
  const webhookProvider: WebhookProvider<Stripe.Event> = {
    name: 'stripe',

    verifySignature(rawBody, headers) {
      const sig = headers['stripe-signature'];
      if (!sig) return { valid: false, reason: 'missing stripe-signature header' };
      try {
        stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
        return { valid: true };
      } catch (err) {
        return { valid: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },

    // verifySignature already authenticated these exact bytes via HMAC — a
    // plain JSON.parse of the same buffer reproduces what constructEvent
    // would return, without re-verifying (constructEvent needs the
    // signature header too, which this method doesn't receive).
    parsePayload(rawBody) {
      return JSON.parse(rawBody.toString('utf8')) as Stripe.Event;
    },

    extractIds(event): ParsedIds {
      // event.id is Stripe's own globally-unique delivery id — the natural
      // idempotency key (Stripe recommends it for exactly this purpose).
      const externalId = event.id;
      const eventType = event.type;
      const kind: ParsedIds['kind'] =
        event.type === 'checkout.session.completed'
          ? 'paid'
          : event.type === 'charge.refunded'
            ? 'refunded'
            : 'other';
      return { externalId, eventType, kind };
    },
  };

  return {
    name: 'stripe',
    charge,
    chargeConnected,
    refund,
    webhookProvider,
  };
}
