// Companion test for the Redis-backed breaker. Uses an in-memory fake Redis
// (with TTL) + fake timers so the OPEN → HALF_OPEN cooldown is deterministic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Redis } from '@/lib/server/redis';
import { createBreaker, CircuitOpenError } from './circuit-breaker-redis';

interface Entry {
  value: string;
  expireAt: number | null;
}

/** Minimal Upstash-shaped fake: get / set({nx,px}) / incr / pexpire / del. */
class FakeRedis {
  private store = new Map<string, Entry>();
  failGet = false;

  private live(key: string): Entry | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.expireAt !== null && Date.now() >= e.expireAt) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  async get<T = string>(key: string): Promise<T | null> {
    if (this.failGet) throw new Error('redis unreachable');
    return (this.live(key)?.value as T) ?? null;
  }

  async set(
    key: string,
    value: string,
    opts?: { nx?: boolean; px?: number },
  ): Promise<'OK' | null> {
    if (opts?.nx && this.live(key)) return null;
    this.store.set(key, {
      value,
      expireAt: opts?.px ? Date.now() + opts.px : null,
    });
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    const cur = Number(this.live(key)?.value ?? '0') + 1;
    const existing = this.store.get(key);
    this.store.set(key, { value: String(cur), expireAt: existing?.expireAt ?? null });
    return cur;
  }

  async pexpire(key: string, ms: number): Promise<number> {
    const e = this.store.get(key);
    if (!e) return 0;
    e.expireAt = Date.now() + ms;
    return 1;
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }

  has(key: string): boolean {
    return this.live(key) !== undefined;
  }
}

const OPTS = { name: 'test', failureThreshold: 5, windowMs: 30_000, cooldownMs: 60_000 };
let redis: FakeRedis;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  redis = new FakeRedis();
});
afterEach(() => vi.useRealTimers());

const asRedis = (r: FakeRedis) => r as unknown as Redis;
const boom = () => Promise.reject(new Error('stripe down'));

describe('RedisCircuitBreaker', () => {
  it('runs the fn and returns its value while CLOSED', async () => {
    const cb = createBreaker(OPTS, asRedis(redis));
    await expect(cb.execute(async () => 'ok')).resolves.toBe('ok');
    expect(await cb.snapshot()).toBe('closed');
  });

  it('opens after failureThreshold failures and then refuses without calling fn', async () => {
    const cb = createBreaker(OPTS, asRedis(redis));
    for (let i = 0; i < 5; i++) await expect(cb.execute(boom)).rejects.toThrow('stripe down');

    expect(redis.has('cb:test:open')).toBe(true);
    expect(await cb.snapshot()).toBe('open');

    const fn = vi.fn(boom);
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('OPEN → HALF_OPEN after cooldown, and a successful probe closes it', async () => {
    const cb = createBreaker(OPTS, asRedis(redis));
    for (let i = 0; i < 5; i++) await cb.execute(boom).catch(() => {});
    expect(await cb.snapshot()).toBe('open');

    vi.advanceTimersByTime(60_001); // past cooldown → :open key expired
    expect(await cb.snapshot()).toBe('half-open');

    await expect(cb.execute(async () => 'recovered')).resolves.toBe('recovered');
    expect(await cb.snapshot()).toBe('closed');
    expect(redis.has('cb:test:armed')).toBe(false);
    expect(redis.has('cb:test:fails')).toBe(false);
  });

  it('a failed HALF_OPEN probe re-opens the circuit', async () => {
    const cb = createBreaker(OPTS, asRedis(redis));
    for (let i = 0; i < 5; i++) await cb.execute(boom).catch(() => {});
    vi.advanceTimersByTime(60_001);
    expect(await cb.snapshot()).toBe('half-open');

    await expect(cb.execute(boom)).rejects.toThrow('stripe down');
    expect(await cb.snapshot()).toBe('open');
  });

  it('HALF_OPEN is single-flight — a concurrent call is refused while the probe runs', async () => {
    const cb = createBreaker(OPTS, asRedis(redis));
    for (let i = 0; i < 5; i++) await cb.execute(boom).catch(() => {});
    vi.advanceTimersByTime(60_001);

    let release!: () => void;
    const slow = cb.execute(() => new Promise<string>((r) => (release = () => r('done'))));
    await Promise.resolve(); // let the probe acquire the lock

    await expect(cb.execute(async () => 'second')).rejects.toBeInstanceOf(CircuitOpenError);
    release();
    await expect(slow).resolves.toBe('done');
  });

  it('reset() clears the shared state', async () => {
    const cb = createBreaker(OPTS, asRedis(redis));
    for (let i = 0; i < 5; i++) await cb.execute(boom).catch(() => {});
    expect(await cb.snapshot()).toBe('open');

    await cb.reset();
    expect(await cb.snapshot()).toBe('closed');
    expect(redis.has('cb:test:open')).toBe(false);
  });

  it('falls back to in-memory when Redis reads throw, still executing the fn', async () => {
    const cb = createBreaker(OPTS, asRedis(redis));
    redis.failGet = true;
    await expect(cb.execute(async () => 'ok')).resolves.toBe('ok');
    // 5 failures via the in-memory fallback still trip it
    for (let i = 0; i < 5; i++) await cb.execute(boom).catch(() => {});
    await expect(cb.execute(vi.fn(boom))).rejects.toBeInstanceOf(CircuitOpenError);
  });
});

describe('createBreaker', () => {
  it('returns an in-memory breaker when no Redis client is available', async () => {
    const cb = createBreaker(OPTS, null);
    for (let i = 0; i < 5; i++) await cb.execute(boom).catch(() => {});
    const fn = vi.fn(boom);
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });
});
