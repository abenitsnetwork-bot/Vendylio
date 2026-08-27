/**
 * Stripe Connect — Express account creation + onboarding links (Phase 3).
 *
 * Deliberately separate from `payments/stripe.ts`'s `PaymentProvider`
 * implementation: account management isn't part of the generic charge/
 * refund/webhook interface every provider implements (Bictorys never had
 * this concept, and a future non-Stripe provider wouldn't share this
 * shape either), so it lives in its own lazy-init module rather than
 * stretching `PaymentProvider`.
 *
 * Uses the same `STRIPE_SECRET_KEY` as the platform charge path — Connect
 * account management doesn't need `STRIPE_WEBHOOK_SECRET` (that's only
 * for verifying inbound webhook deliveries, handled separately in
 * webhook/stripe.ts).
 */
import 'server-only';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from './stripe';

export class StripeConnectUnconfiguredError extends Error {
  constructor() {
    super('Stripe Connect not configured (STRIPE_SECRET_KEY missing or empty)');
    this.name = 'StripeConnectUnconfiguredError';
  }
}

let _client: Stripe | null = null;

function getClient(): Stripe {
  if (_client) return _client;
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!secretKey) throw new StripeConnectUnconfiguredError();
  _client = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, typescript: true });
  return _client;
}

/** Creates a new Express connected account for a seller. Returns the account id. */
export async function createExpressAccount(email: string): Promise<string> {
  const stripe = getClient();
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
  return account.id;
}

/** Creates a fresh onboarding link for an existing (or just-created) account. */
export async function createOnboardingLink(
  accountId: string,
  refreshUrl: string,
  returnUrl: string,
): Promise<string> {
  const stripe = getClient();
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  });
  return link.url;
}

export interface AccountCapabilities {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

/** Reads the current capability flags for an account (used by GET status + the webhook). */
export async function retrieveAccountCapabilities(accountId: string): Promise<AccountCapabilities> {
  const stripe = getClient();
  const account = await stripe.accounts.retrieve(accountId);
  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
  };
}

/** Test-only escape hatch — clears the cached client for `vi.stubEnv` reuse. */
export function __resetStripeConnectClient(): void {
  _client = null;
}
