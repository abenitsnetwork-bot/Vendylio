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

/**
 * Phase 2 — move `amountCents` from the platform balance to the seller's
 * connected account (a Connect transfer). Stripe then ACHs it to the seller's
 * bank on their account's payout schedule. `idempotencyKey` makes a retry
 * (double admin click, network hiccup) safe — Stripe returns the original
 * transfer instead of creating a second one.
 *
 * Throws `StripeConnectUnconfiguredError` when Stripe env is absent, or a
 * `Stripe.errors.StripeError` when the transfer is rejected (insufficient
 * platform balance, destination account can't receive, …) — the caller
 * classifies + surfaces those.
 */
export async function createConnectTransfer(opts: {
  destinationAccountId: string;
  amountCents: number;
  currency: string;
  withdrawalId: string;
}): Promise<{ transferId: string }> {
  const stripe = getClient();
  const transfer = await stripe.transfers.create(
    {
      amount: opts.amountCents,
      currency: opts.currency.toLowerCase(),
      destination: opts.destinationAccountId,
      metadata: { withdrawalId: opts.withdrawalId },
    },
    { idempotencyKey: `wd-transfer-${opts.withdrawalId}` },
  );
  return { transferId: transfer.id };
}

/** Test-only escape hatch — clears the cached client for `vi.stubEnv` reuse. */
export function __resetStripeConnectClient(): void {
  _client = null;
}
