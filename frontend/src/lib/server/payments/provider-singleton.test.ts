import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getProvider,
  breaker,
  PaymentProviderUnconfiguredError,
  __resetProviderSingleton,
} from './provider-singleton';

beforeEach(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_fixture');
  __resetProviderSingleton();
  await breaker.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __resetProviderSingleton();
});

describe('provider-singleton (lazy init)', () => {
  it('throws PaymentProviderUnconfiguredError when STRIPE_SECRET_KEY is missing', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect(() => getProvider()).toThrow(PaymentProviderUnconfiguredError);
  });

  it('throws PaymentProviderUnconfiguredError when STRIPE_WEBHOOK_SECRET is missing', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect(() => getProvider()).toThrow(PaymentProviderUnconfiguredError);
  });

  it('constructs and caches a single provider instance across calls', () => {
    const a = getProvider();
    const b = getProvider();
    expect(a).toBe(b);
    expect(a.name).toBe('stripe');
  });

  it('exposes a shared, resettable breaker (in-memory in tests — no Upstash env)', async () => {
    expect(await breaker.snapshot()).toBe('closed');
  });
});
