// Phase 1a — Stripe Billing (the Vendylio Pro *subscription*).
//
// Deliberately separate from `payments/stripe.ts` (customer CHARGES for
// orders) and `payments/stripe-connect.ts` (merchant payout accounts): this
// is Vendylio billing the merchant $29/mo. Same `STRIPE_SECRET_KEY`, its own
// price id (`STRIPE_PRO_PRICE_ID`) and its own webhook secret
// (`STRIPE_BILLING_WEBHOOK_SECRET`, consumed in webhook/stripe-billing.ts).
//
// Lazy-init so `vi.stubEnv` works in tests and the app still boots with no
// Stripe env (routes return 503 BILLING_NOT_CONFIGURED instead of throwing
// at import time).
import 'server-only';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { STRIPE_API_VERSION } from '../payments/stripe';

export class BillingUnconfiguredError extends Error {
  constructor() {
    super('Billing not configured (STRIPE_SECRET_KEY / STRIPE_PRO_PRICE_ID missing)');
    this.name = 'BillingUnconfiguredError';
  }
}

let _client: Stripe | null = null;

function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

export type BillingInterval = 'month' | 'year';

/** The Stripe price id for the requested interval. `year` falls back to the
 *  monthly price when no annual price is configured. */
export function getProPriceId(interval: BillingInterval = 'month'): string {
  if (interval === 'year' && process.env.STRIPE_PRO_ANNUAL_PRICE_ID) {
    return process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
  }
  return process.env.STRIPE_PRO_PRICE_ID ?? '';
}

/** Whether a distinct annual price is configured (drives the pricing toggle). */
export function annualBillingAvailable(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRO_ANNUAL_PRICE_ID);
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && getProPriceId('month'));
}

function getClient(): Stripe {
  if (_client) return _client;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey || !getProPriceId('month')) throw new BillingUnconfiguredError();
  _client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });
  return _client;
}

type BillingStoreClient = Pick<PrismaClient, 'store'>;

interface StoreForBilling {
  id: string;
  name: string;
  stripeCustomerId: string | null;
}

/**
 * Return the store's Stripe customer id, creating (and persisting) one on
 * first use. `email` is the signed-in merchant's address — used only as the
 * customer's contact, never as an identity key (the store id in metadata is
 * the join key back to our row).
 */
export async function getOrCreateBillingCustomer(
  prisma: BillingStoreClient,
  store: StoreForBilling,
  email: string,
): Promise<string> {
  if (store.stripeCustomerId) return store.stripeCustomerId;

  const stripe = getClient();
  const customer = await stripe.customers.create({
    email,
    name: store.name,
    metadata: { storeId: store.id },
  });

  await prisma.store.update({
    where: { id: store.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/**
 * Hosted Checkout for the recurring Pro price. `clientReferenceId` = the
 * store id so a stray webhook can still be correlated; the subscription's
 * own `metadata.storeId` is the primary join key (set here so it rides
 * through to `customer.subscription.*` events).
 */
export async function createProCheckoutSession(opts: {
  customerId: string;
  storeId: string;
  interval?: BillingInterval;
}): Promise<{ url: string }> {
  const stripe = getClient();
  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: opts.customerId,
    client_reference_id: opts.storeId,
    line_items: [{ price: getProPriceId(opts.interval ?? 'month'), quantity: 1 }],
    subscription_data: { metadata: { storeId: opts.storeId } },
    success_url: `${base}/dashboard/billing?upgraded=1`,
    cancel_url: `${base}/dashboard/billing`,
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  return { url: session.url };
}

/** Stripe-hosted billing portal (update card, cancel, view invoices). */
export async function createPortalSession(opts: { customerId: string }): Promise<{ url: string }> {
  const stripe = getClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: opts.customerId,
    return_url: `${appUrl()}/dashboard/billing`,
  });
  return { url: session.url };
}

// ── Phase 1b — a card on file so Vendylio can invoice Cash App / Zelle
// commission a merchant with no withdrawable balance would otherwise never
// pay. Same billing customer as the Pro subscription. ──────────────────────

/**
 * Hosted Checkout in `setup` mode — collects a reusable card and attaches it
 * to the billing customer (Stripe Checkout attaches it automatically on
 * completion; the webhook also marks it the customer's default). Used to
 * satisfy the "payment method required" gate before enabling Cash App / Zelle.
 */
export async function createCardSetupSession(opts: {
  customerId: string;
  storeId: string;
}): Promise<{ url: string }> {
  const stripe = getClient();
  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: opts.customerId,
    currency: 'usd',
    client_reference_id: opts.storeId,
    setup_intent_data: { metadata: { storeId: opts.storeId, purpose: 'commission_card' } },
    success_url: `${base}/dashboard/settings?tab=payments&card=added`,
    cancel_url: `${base}/dashboard/settings?tab=payments`,
  });
  if (!session.url) throw new Error('Stripe did not return a Checkout URL');
  return { url: session.url };
}

/** The first saved card on the customer, or null. */
export async function getDefaultCardPaymentMethodId(customerId: string): Promise<string | null> {
  const stripe = getClient();
  const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  const fromDefault =
    typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : (customer.invoice_settings?.default_payment_method?.id ?? null);
  if (fromDefault) return fromDefault;
  const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
  return list.data[0]?.id ?? null;
}

/** True when the merchant has a usable card on file for `charge_automatically`. */
export async function hasBillablePaymentMethod(customerId: string | null): Promise<boolean> {
  if (!customerId) return false;
  return (await getDefaultCardPaymentMethodId(customerId)) !== null;
}

/** Promote a payment method to the customer's invoice default (idempotent). */
export async function setDefaultPaymentMethod(
  customerId: string,
  paymentMethodId: string,
): Promise<void> {
  const stripe = getClient();
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
}

/**
 * After a `mode: 'setup'` Checkout completes, make the collected card the
 * customer's invoice default so the commission-settlement sweep can charge it.
 * Stripe Checkout already attached the PM to the customer; this only sets the
 * default. Best-effort — returns false when the shapes aren't what we expect.
 */
export async function promoteSetupIntentCard(setupIntentId: string): Promise<boolean> {
  const stripe = getClient();
  const si = await stripe.setupIntents.retrieve(setupIntentId);
  const customerId = typeof si.customer === 'string' ? si.customer : (si.customer?.id ?? null);
  const pmId =
    typeof si.payment_method === 'string' ? si.payment_method : (si.payment_method?.id ?? null);
  if (!customerId || !pmId) return false;
  await setDefaultPaymentMethod(customerId, pmId);
  return true;
}

export interface CommissionInvoiceLine {
  amountCents: number;
  description: string;
}

/**
 * Create + finalize a `charge_automatically` invoice for the merchant's
 * outstanding Cash App / Zelle commission. Stripe attempts payment right away;
 * `invoice.paid` (→ webhook) flips the CommissionCharge rows to SETTLED.
 * Returns the invoice id to stamp onto those rows.
 */
export async function createCommissionInvoice(opts: {
  customerId: string;
  storeId: string;
  lines: CommissionInvoiceLine[];
}): Promise<{ invoiceId: string }> {
  const stripe = getClient();
  const pmId = await getDefaultCardPaymentMethodId(opts.customerId);
  if (!pmId) throw new Error('No card on file for commission invoice');

  const invoice = await stripe.invoices.create({
    customer: opts.customerId,
    collection_method: 'charge_automatically',
    auto_advance: true,
    default_payment_method: pmId,
    description: 'Vendylio marketplace commission (Cash App / Zelle orders)',
    metadata: { kind: 'commission_settlement', storeId: opts.storeId },
  });

  for (const line of opts.lines) {
    await stripe.invoiceItems.create({
      customer: opts.customerId,
      invoice: invoice.id,
      currency: 'usd',
      amount: line.amountCents,
      description: line.description,
    });
  }

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  return { invoiceId: finalized.id };
}

/** Test-only — clear the cached client so `vi.stubEnv` can reconfigure. */
export function __resetBillingClient(): void {
  _client = null;
}
