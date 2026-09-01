import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, withTimeout, classifyDeliveryError, DeliveryTimeoutError } from './http';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('resolves the fast path untouched', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it('fires onTimeout when the promise is too slow', async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r('late'), 50));
    await expect(withTimeout(slow, 5, () => 'fallback')).resolves.toBe('fallback');
  });

  it('rejects with DeliveryTimeoutError when no fallback is given', async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r('late'), 50));
    await expect(withTimeout(slow, 5, undefined, 'uber getDelivery')).rejects.toBeInstanceOf(
      DeliveryTimeoutError,
    );
  });

  it('propagates a rejection from the underlying promise', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});

describe('fetchWithTimeout', () => {
  it('returns the response on the happy path', async () => {
    const res = new Response('ok', { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res),
    );
    await expect(fetchWithTimeout('https://api.example.com/x', {}, 1000)).resolves.toBe(res);
  });

  it('maps an AbortError into DeliveryTimeoutError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }),
    );
    await expect(fetchWithTimeout('https://api.example.com/x', {}, 5)).rejects.toBeInstanceOf(
      DeliveryTimeoutError,
    );
  });

  it('rethrows a non-abort network error unchanged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );
    await expect(fetchWithTimeout('https://api.example.com/x')).rejects.toThrow('ECONNRESET');
  });
});

describe('classifyDeliveryError', () => {
  it.each([
    [new DeliveryTimeoutError('x'), 'DELIVERY_TIMEOUT'],
    [new Error('request timed out'), 'DELIVERY_TIMEOUT'],
    [new Error('HTTP 429 Too Many Requests'), 'DELIVERY_RATE_LIMITED'],
    [new Error('rate limit exceeded'), 'DELIVERY_RATE_LIMITED'],
    [new Error('401 Unauthorized'), 'DELIVERY_AUTH_FAILED'],
    [new Error('invalid api key'), 'DELIVERY_AUTH_FAILED'],
    [new Error('The specified location is not in a deliverable area'), 'DELIVERY_INVALID_ADDRESS'],
    [new Error('no courier available'), 'DELIVERY_NO_COURIER'],
    [new Error('no dasher could be assigned'), 'DELIVERY_NO_COURIER'],
    [new Error('something odd happened'), 'DELIVERY_PROVIDER_UNAVAILABLE'],
    ['a bare string', 'DELIVERY_PROVIDER_UNAVAILABLE'],
  ])('maps %o → %s', (err, code) => {
    const out = classifyDeliveryError(err);
    expect(out.code).toBe(code);
    expect(out.message).toBeTruthy();
    // never leaks the raw provider text
    expect(out.message).not.toMatch(/429|401|dasher/i);
  });
});
