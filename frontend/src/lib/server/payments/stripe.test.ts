import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// The Stripe SDK builds its resource clients (checkout, refunds, webhooks)
// per-instance in the constructor, not on the prototype — spying on an
// internally-constructed instance isn't possible from outside, so the whole
// module is mocked. `generateTestHeaderString`/`constructEvent` are real
// HMAC logic reimplemented minimally here (sha256 of `${ts}.${payload}`,
// matching Stripe's actual v1 scheme) so verifySignature's tamper-detection
// path is genuinely exercised rather than stubbed to always pass.
const { sessionsCreate, sessionsRetrieve, refundsCreate } = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  sessionsRetrieve: vi.fn(),
  refundsCreate: vi.fn(),
}));

vi.mock('stripe', () => {
  class FakeStripeError extends Error {}
  class FakeStripe {
    checkout = { sessions: { create: sessionsCreate, retrieve: sessionsRetrieve } };
    refunds = { create: refundsCreate };
    webhooks = {
      generateTestHeaderString(opts: { payload: string; secret: string; timestamp?: number }) {
        const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
        const sig = crypto
          .createHmac('sha256', opts.secret)
          .update(`${ts}.${opts.payload}`)
          .digest('hex');
        return `t=${ts},v1=${sig}`;
      },
      constructEvent(payload: string | Buffer, header: string, secret: string) {
        const body = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
        const parts = Object.fromEntries(
          header.split(',').map((p) => p.split('=') as [string, string]),
        );
        const expected = crypto
          .createHmac('sha256', secret)
          .update(`${parts.t}.${body}`)
          .digest('hex');
        if (expected !== parts.v1) throw new FakeStripeError('signature mismatch');
        return JSON.parse(body);
      },
    };
    static errors = { StripeError: FakeStripeError };
  }
  return { default: FakeStripe, errors: { StripeError: FakeStripeError } };
});

import Stripe from 'stripe';
import { createStripeProvider } from './stripe';

const ENV = { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture' };

beforeEach(() => {
  sessionsCreate.mockReset();
  sessionsRetrieve.mockReset();
  refundsCreate.mockReset();
});

describe('createStripeProvider', () => {
  it('throws when STRIPE_SECRET_KEY is missing', () => {
    expect(() => createStripeProvider({ ...ENV, STRIPE_SECRET_KEY: '' })).toThrow(
      /STRIPE_SECRET_KEY is required/,
    );
  });

  it('throws when STRIPE_WEBHOOK_SECRET is missing', () => {
    expect(() => createStripeProvider({ ...ENV, STRIPE_WEBHOOK_SECRET: '' })).toThrow(
      /STRIPE_WEBHOOK_SECRET is required/,
    );
  });

  describe('charge', () => {
    it('creates a Checkout Session and returns providerChargeId + paymentUrl', async () => {
      const provider = createStripeProvider(ENV);
      sessionsCreate.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
      });

      const result = await provider.charge({
        amount: 3600,
        currency: 'USD',
        customer: { email: 'buyer@example.com', name: 'Amara' },
        successUrl: 'https://vendylio.test/success',
        failureUrl: 'https://vendylio.test/failure',
        externalRef: 'order-1',
      });

      expect(result).toEqual({
        providerChargeId: 'cs_test_123',
        paymentUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        status: 'PENDING',
      });

      const args = sessionsCreate.mock.calls[0]?.[0];
      expect(args.mode).toBe('payment');
      expect(args.client_reference_id).toBe('order-1');
      expect(args.customer_email).toBe('buyer@example.com');
      expect(args.line_items[0].price_data.unit_amount).toBe(3600);
    });

    it('throws when Stripe returns no session URL', async () => {
      const provider = createStripeProvider(ENV);
      sessionsCreate.mockResolvedValue({ id: 'cs_test_no_url', url: null });

      await expect(
        provider.charge({
          amount: 1000,
          currency: 'USD',
          customer: {},
          successUrl: 'https://vendylio.test/success',
          failureUrl: 'https://vendylio.test/failure',
          externalRef: 'order-2',
        }),
      ).rejects.toThrow(/did not return a checkout URL/);
    });

    it('wraps a Stripe API error with a descriptive message', async () => {
      const provider = createStripeProvider(ENV);
      sessionsCreate.mockRejectedValue(new Error('network down'));

      await expect(
        provider.charge({
          amount: 1000,
          currency: 'USD',
          customer: {},
          successUrl: 'https://vendylio.test/success',
          failureUrl: 'https://vendylio.test/failure',
          externalRef: 'order-3',
        }),
      ).rejects.toThrow(/Stripe checkout session creation failed/);
    });
  });

  describe('chargeConnected', () => {
    it('creates a destination-charge Checkout Session with application_fee_amount + transfer_data', async () => {
      const provider = createStripeProvider(ENV);
      sessionsCreate.mockResolvedValue({
        id: 'cs_connect_1',
        url: 'https://checkout.stripe.com/pay/cs_connect_1',
      });

      const result = await provider.chargeConnected({
        amount: 3600,
        currency: 'USD',
        customer: { email: 'buyer@example.com' },
        successUrl: 'https://vendylio.test/success',
        failureUrl: 'https://vendylio.test/failure',
        externalRef: 'order-1',
        destinationAccountId: 'acct_seller_1',
        applicationFeeAmount: 216,
      });

      expect(result).toEqual({
        providerChargeId: 'cs_connect_1',
        paymentUrl: 'https://checkout.stripe.com/pay/cs_connect_1',
        status: 'PENDING',
      });

      const args = sessionsCreate.mock.calls[0]?.[0];
      expect(args.payment_intent_data).toEqual({
        application_fee_amount: 216,
        transfer_data: { destination: 'acct_seller_1' },
      });
    });

    it('wraps a Stripe API error with a descriptive message', async () => {
      const provider = createStripeProvider(ENV);
      sessionsCreate.mockRejectedValue(new Error('account restricted'));

      await expect(
        provider.chargeConnected({
          amount: 1000,
          currency: 'USD',
          customer: {},
          successUrl: 'https://vendylio.test/success',
          failureUrl: 'https://vendylio.test/failure',
          externalRef: 'order-2',
          destinationAccountId: 'acct_seller_2',
          applicationFeeAmount: 60,
        }),
      ).rejects.toThrow(/Stripe destination-charge session creation failed/);
    });
  });

  describe('refund', () => {
    it('refunds directly by PaymentIntent id', async () => {
      const provider = createStripeProvider(ENV);
      refundsCreate.mockResolvedValue({ id: 're_1', status: 'succeeded' });

      const result = await provider.refund!({ providerChargeId: 'pi_test_1' });

      expect(result).toEqual({ providerRefundId: 're_1', status: 'COMPLETED' });
      expect(refundsCreate.mock.calls[0]?.[0]).toMatchObject({ payment_intent: 'pi_test_1' });
    });

    it('resolves a Checkout Session id to its PaymentIntent before refunding', async () => {
      const provider = createStripeProvider(ENV);
      sessionsRetrieve.mockResolvedValue({ payment_intent: 'pi_resolved' });
      refundsCreate.mockResolvedValue({ id: 're_2', status: 'pending' });

      const result = await provider.refund!({ providerChargeId: 'cs_test_1', amount: 500 });

      expect(sessionsRetrieve).toHaveBeenCalledWith('cs_test_1');
      expect(refundsCreate.mock.calls[0]?.[0]).toMatchObject({
        payment_intent: 'pi_resolved',
        amount: 500,
      });
      expect(result.status).toBe('PENDING');
    });

    it('throws when the Checkout Session has no PaymentIntent', async () => {
      const provider = createStripeProvider(ENV);
      sessionsRetrieve.mockResolvedValue({ payment_intent: null });

      await expect(provider.refund!({ providerChargeId: 'cs_test_no_pi' })).rejects.toThrow(
        /has no PaymentIntent to refund/,
      );
    });
  });

  describe('webhookProvider', () => {
    it('verifySignature accepts a correctly-signed body', () => {
      const provider = createStripeProvider(ENV);
      const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
      const payload = JSON.stringify({ id: 'evt_1' });
      const sig = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: ENV.STRIPE_WEBHOOK_SECRET,
      });
      const result = provider.webhookProvider.verifySignature(Buffer.from(payload), {
        'stripe-signature': sig,
      });
      expect(result.valid).toBe(true);
    });

    it('verifySignature rejects a missing header', () => {
      const provider = createStripeProvider(ENV);
      const result = provider.webhookProvider.verifySignature(Buffer.from('{}'), {});
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/missing stripe-signature/);
    });

    it('verifySignature rejects a tampered body', () => {
      const provider = createStripeProvider(ENV);
      const stripe = new Stripe(ENV.STRIPE_SECRET_KEY);
      const payload = JSON.stringify({ id: 'evt_1' });
      const sig = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: ENV.STRIPE_WEBHOOK_SECRET,
      });
      const result = provider.webhookProvider.verifySignature(
        Buffer.from('{"id":"evt_tampered"}'),
        { 'stripe-signature': sig },
      );
      expect(result.valid).toBe(false);
    });

    it('parsePayload JSON-parses the raw bytes', () => {
      const provider = createStripeProvider(ENV);
      const parsed = provider.webhookProvider.parsePayload(
        Buffer.from(JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })),
      );
      expect(parsed).toMatchObject({ id: 'evt_1', type: 'checkout.session.completed' });
    });

    it('extractIds classifies checkout.session.completed as paid', () => {
      const provider = createStripeProvider(ENV);
      const ids = provider.webhookProvider.extractIds({
        id: 'evt_1',
        type: 'checkout.session.completed',
      } as never);
      expect(ids).toEqual({
        externalId: 'evt_1',
        eventType: 'checkout.session.completed',
        kind: 'paid',
      });
    });

    it('extractIds classifies charge.refunded as refunded', () => {
      const provider = createStripeProvider(ENV);
      const ids = provider.webhookProvider.extractIds({
        id: 'evt_2',
        type: 'charge.refunded',
      } as never);
      expect(ids.kind).toBe('refunded');
    });

    it('extractIds classifies everything else as other', () => {
      const provider = createStripeProvider(ENV);
      const ids = provider.webhookProvider.extractIds({
        id: 'evt_3',
        type: 'customer.created',
      } as never);
      expect(ids.kind).toBe('other');
    });
  });
});
