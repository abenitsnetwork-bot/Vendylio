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

export function getProPriceId(): string {
  return process.env.STRIPE_PRO_PRICE_ID ?? '';
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && getProPriceId());
}

function getClient(): Stripe {
  if (_client) return _client;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey || !getProPriceId()) throw new BillingUnconfiguredError();
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
}): Promise<{ url: string }> {
  const stripe = getClient();
  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: opts.customerId,
    client_reference_id: opts.storeId,
    line_items: [{ price: getProPriceId(), quantity: 1 }],
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

/** Test-only — clear the cached client so `vi.stubEnv` can reconfigure. */
export function __resetBillingClient(): void {
  _client = null;
}
