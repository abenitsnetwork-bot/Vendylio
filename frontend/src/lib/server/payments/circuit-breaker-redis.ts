/**
 * Redis-backed circuit breaker — multi-instance variant of
 * `payments/circuit-breaker.ts`.
 *
 * WHY: the in-memory `CircuitBreaker` keeps its failure counter in the Node
 * process. On Vercel every warm lambda has its own, so during a Stripe outage
 * the platform makes `failureThreshold × <warm instances>` failing calls
 * before *any* instance trips. This variant keeps the state in Upstash so all
 * instances share one breaker.
 *
 * Same `execute<T>(fn)` contract as the in-memory class, same `CircuitOpenError`
 * (with `.retryAt`) — `provider-singleton.ts` swaps `new CircuitBreaker(...)`
 * for `createBreaker(...)` and nothing else changes. The in-memory
 * `circuit-breaker.ts` (PROTECTED) is untouched and stays the fallback.
 *
 * State (keys namespaced by `cb:<name>:`):
 *   - `:open`   present ⇒ OPEN. TTL = cooldownMs, value = retryAt ISO string.
 *   - `:armed`  present + `:open` absent ⇒ HALF_OPEN. TTL = cooldownMs+windowMs.
 *   - `:fails`  rolling failure count. TTL = windowMs (set on the first failure —
 *              an approximate window, documented, same as the in-memory one).
 *   - `:probe`  NX single-flight lock so only one call probes in HALF_OPEN.
 *
 * Degradation: if Redis is unreachable (or unconfigured — dev), every call
 * delegates to a lazily-created in-memory `CircuitBreaker` with the same
 * options, so behaviour is never worse than today.
 */
import 'server-only';
import { getRedis, type Redis } from '@/lib/server/redis';
import { createLogger } from '@/lib/server/logger';
import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitBreakerOptions,
  type CircuitState,
} from '@/lib/server/payments/circuit-breaker';

export { CircuitOpenError };

const log = createLogger();

export interface Breaker {
  execute<T>(fn: () => Promise<T>): Promise<T>;
  /** Best-effort current state — for diagnostics / tests, not the hot path. */
  snapshot(): Promise<CircuitState>;
  /** Force back to CLOSED (clears shared state). Diagnostics / tests. */
  reset(): Promise<void>;
}

const PROBE_TTL_MS = 10_000;

class RedisCircuitBreaker implements Breaker {
  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly redis: Redis;
  /** Used only when a Redis call throws mid-flight. */
  private readonly fallback: CircuitBreaker;

  constructor(redis: Redis, opts: CircuitBreakerOptions) {
    this.redis = redis;
    this.name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.windowMs = opts.windowMs ?? 30_000;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.fallback = new CircuitBreaker(opts);
  }

  private k(suffix: string): string {
    return `cb:${this.name}:${suffix}`;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.run(fn);
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      // Re-throw application/provider errors untouched — `run` already
      // recorded the failure in Redis.
      throw err;
    }
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    let openIso: string | null;
    try {
      openIso = (await this.redis.get<string>(this.k('open'))) ?? null;
    } catch (err) {
      log.warn(`circuit-breaker-redis: read failed for "${this.name}", using in-memory fallback`, {
        err: String(err),
      });
      return this.fallback.execute(fn);
    }

    if (openIso) {
      // OPEN — cooldown has not elapsed (the key's TTL is the cooldown).
      throw new CircuitOpenError(this.name, this.parseRetryAt(openIso));
    }

    const armed = await this.safeGet(this.k('armed'));
    if (armed) {
      // HALF_OPEN — allow exactly one probe.
      const gotProbe = await this.safeSetNx(this.k('probe'), PROBE_TTL_MS);
      if (!gotProbe) {
        throw new CircuitOpenError(this.name, new Date(Date.now() + this.cooldownMs));
      }
      try {
        const out = await fn();
        await this.safeDel(this.k('fails'), this.k('armed'), this.k('probe'));
        return out;
      } catch (err) {
        await this.open();
        await this.safeDel(this.k('probe'));
        throw err;
      }
    }

    // CLOSED.
    try {
      return await fn();
    } catch (err) {
      await this.recordFailure();
      throw err;
    }
  }

  private async recordFailure(): Promise<void> {
    try {
      const n = await this.redis.incr(this.k('fails'));
      if (n === 1) await this.redis.pexpire(this.k('fails'), this.windowMs);
      if (n >= this.failureThreshold) await this.open();
    } catch (err) {
      log.warn(`circuit-breaker-redis: recordFailure failed for "${this.name}"`, {
        err: String(err),
      });
    }
  }

  private async open(): Promise<void> {
    const retryAt = new Date(Date.now() + this.cooldownMs).toISOString();
    try {
      await this.redis.set(this.k('open'), retryAt, { px: this.cooldownMs });
      await this.redis.set(this.k('armed'), '1', { px: this.cooldownMs + this.windowMs });
    } catch (err) {
      log.warn(`circuit-breaker-redis: open() failed for "${this.name}"`, { err: String(err) });
    }
  }

  private parseRetryAt(iso: string): Date {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? new Date(Date.now() + this.cooldownMs) : d;
  }

  async snapshot(): Promise<CircuitState> {
    try {
      if (await this.safeGet(this.k('open'))) return 'open';
      if (await this.safeGet(this.k('armed'))) return 'half-open';
      return 'closed';
    } catch {
      return this.fallback.state();
    }
  }

  async reset(): Promise<void> {
    this.fallback.reset();
    await this.safeDel(this.k('open'), this.k('armed'), this.k('fails'), this.k('probe'));
  }

  private async safeGet(key: string): Promise<string | null> {
    try {
      return (await this.redis.get<string>(key)) ?? null;
    } catch {
      return null;
    }
  }

  private async safeSetNx(key: string, px: number): Promise<boolean> {
    try {
      return (await this.redis.set(key, '1', { nx: true, px })) === 'OK';
    } catch {
      return true; // fail-open on the lock — better a possible double probe than a stuck breaker
    }
  }

  private async safeDel(...keys: string[]): Promise<void> {
    try {
      await this.redis.del(...keys);
    } catch {
      /* best-effort */
    }
  }
}

/** Adapts the in-memory `CircuitBreaker` to the async `Breaker` interface. */
class InMemoryBreakerAdapter implements Breaker {
  private readonly cb: CircuitBreaker;
  constructor(opts: CircuitBreakerOptions) {
    this.cb = new CircuitBreaker(opts);
  }
  execute<T>(fn: () => Promise<T>): Promise<T> {
    return this.cb.execute(fn);
  }
  async snapshot(): Promise<CircuitState> {
    return this.cb.state();
  }
  async reset(): Promise<void> {
    this.cb.reset();
  }
}

/**
 * Returns a Redis-backed breaker when Upstash is configured, otherwise an
 * in-memory one (dev / single instance). `redisClient` is injectable for tests.
 */
export function createBreaker(
  opts: CircuitBreakerOptions,
  redisClient: Redis | null = getRedis(),
): Breaker {
  if (redisClient) return new RedisCircuitBreaker(redisClient, opts);
  return new InMemoryBreakerAdapter(opts);
}
