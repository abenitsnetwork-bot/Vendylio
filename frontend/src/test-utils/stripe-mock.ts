// frontend/src/test-utils/stripe-mock.ts — Phase 2.
//
// Fixture builder for /api/webhooks/stripe route tests. Returns:
//   - rawBody (Buffer) — exact bytes Stripe would have signed
//   - headers (Record<string,string>) — including a valid stripe-signature
//   - event (Stripe.Event) — the parsed shape
//
// Signature generation uses the real Stripe SDK's own
// `webhooks.generateTestHeaderString` ("useful for signing payloads in unit
// tests" per its doc comment) rather than hand-rolling the HMAC scheme —
// drift between fixture and verifier is impossible by construction.
import Stripe from 'stripe';
import { NextRequest } from 'next/server';

const stripe = new Stripe('sk_test_fixture_only', { apiVersion: '2026-07-29.dahlia' });

export interface StripeFixtureOpts {
  type?: 'checkout.session.completed' | 'charge.refunded' | 'checkout.session.expired';
  sessionId?: string;
  amountTotal?: number;
  customerEmail?: string | null;
  paymentMethodTypes?: string[];
  paymentStatus?: string;
  webhookSecret?: string;
  eventId?: string;
  /** PaymentIntent id carried by the session (onPaid) or the charge (onRefunded). */
  paymentIntentId?: string | null;
  /** charge.refunded only — `charge.refunded` bool (true = fully refunded). */
  chargeRefunded?: boolean;
  chargeId?: string;
}

export function stripeFixture(opts: StripeFixtureOpts = {}): {
  rawBody: Buffer;
  headers: Record<string, string>;
  event: Stripe.Event;
} {
  const type = opts.type ?? 'checkout.session.completed';
  const sessionId = opts.sessionId ?? 'cs_test_001';
  const paymentIntentId = opts.paymentIntentId === undefined ? 'pi_test_001' : opts.paymentIntentId;

  const dataObject =
    type === 'charge.refunded'
      ? {
          id: opts.chargeId ?? 'ch_test_001',
          object: 'charge',
          payment_intent: paymentIntentId,
          refunded: opts.chargeRefunded ?? true,
          amount: opts.amountTotal ?? 3600,
          amount_refunded: opts.amountTotal ?? 3600,
        }
      : {
          id: sessionId,
          object: 'checkout.session',
          amount_total: opts.amountTotal ?? 3600,
          customer_email: opts.customerEmail ?? null,
          payment_method_types: opts.paymentMethodTypes ?? ['card'],
          payment_status: opts.paymentStatus ?? 'paid',
          payment_intent: paymentIntentId,
        };

  const event = {
    id: opts.eventId ?? 'evt_test_001',
    object: 'event',
    type,
    data: { object: dataObject },
  } as unknown as Stripe.Event;

  const payload = JSON.stringify(event);
  const secret = opts.webhookSecret ?? 'test-webhook-secret';
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });

  return {
    rawBody: Buffer.from(payload),
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
    event,
  };
}

/** Build a NextRequest with the fixture body + headers. Use in route tests. */
export function stripeFixtureRequest(opts: StripeFixtureOpts = {}): {
  req: NextRequest;
  event: Stripe.Event;
} {
  const { rawBody, headers, event } = stripeFixture(opts);
  const body = rawBody as unknown as BodyInit;
  return {
    req: new NextRequest('http://localhost/api/webhooks/stripe', { method: 'POST', headers, body }),
    event,
  };
}
