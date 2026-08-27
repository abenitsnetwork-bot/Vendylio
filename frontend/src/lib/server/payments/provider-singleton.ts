// Lazy-initialized Stripe provider + module-level CircuitBreaker.
// Recreated for Phase 2 — mirrors the shape of the pre-Phase-0 Bictorys
// singleton (same lazy-init-to-avoid-import-time-throw rationale, same
// single-instance CircuitBreaker caveat).
//
// Why lazy?
//   `createStripeProvider({...})` throws synchronously if STRIPE_SECRET_KEY
//   or STRIPE_WEBHOOK_SECRET is missing. Calling it at module top-level
//   inside a route would crash the route module on import — every
//   POST /api/orders would then 500 with no useful error. `getProvider()`
//   instead constructs on first call and throws a typed
//   `PaymentProviderUnconfiguredError` the route translates to a clean 503.
//
// Why a single shared CircuitBreaker?
//   The breaker holds in-memory failure-counter state. Re-instantiating it
//   per request would defeat its purpose. Sharing it at module scope is by
//   design — see CLAUDE.md "single-instance only" note. For multi-pod
//   deployments swap for a Redis-backed variant.
import 'server-only';
import { createStripeProvider, type StripeProviderHandle } from '@/lib/server/payments/stripe';
import { CircuitBreaker } from '@/lib/server/payments/circuit-breaker';

/**
 * Thrown by `getProvider()` when STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET
 * is missing/empty. The orders route should catch this `instanceof` and
 * return 503 PAYMENT_PROVIDER_UNCONFIGURED.
 */
export class PaymentProviderUnconfiguredError extends Error {
  constructor() {
    super('Payment provider not configured (STRIPE_SECRET_KEY/_WEBHOOK_SECRET missing or empty)');
    this.name = 'PaymentProviderUnconfiguredError';
  }
}

let _provider: StripeProviderHandle | null = null;

/**
 * Lazy-init singleton accessor. First call reads `process.env`, constructs
 * the Stripe provider, and caches the handle. Subsequent calls reuse the
 * cached instance. Throws `PaymentProviderUnconfiguredError` if any required
 * env var is missing — the route translates that to 503.
 */
export function getProvider(): StripeProviderHandle {
  if (_provider) return _provider;

  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? '';

  if (!secretKey || !webhookSecret) {
    throw new PaymentProviderUnconfiguredError();
  }

  _provider = createStripeProvider({
    STRIPE_SECRET_KEY: secretKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  });
  return _provider;
}

/**
 * Module-level CircuitBreaker — single-instance only per CLAUDE.md.
 * Same thresholds as the pre-Phase-0 Bictorys breaker: 5 failures within a
 * 30s window trips OPEN, 60s cooldown before a HALF_OPEN probe.
 */
export const breaker = new CircuitBreaker({
  name: 'stripe.charge',
  failureThreshold: 5,
  windowMs: 30_000,
  cooldownMs: 60_000,
});

/**
 * Test-only escape hatch — clears the cached provider so a test can mutate
 * `process.env.STRIPE_*` and re-trigger lazy init. Never call this from
 * application code.
 *
 * @internal
 */
export function __resetProviderSingleton(): void {
  _provider = null;
}
