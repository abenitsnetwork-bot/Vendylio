import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { createIpLimiter } from './rate-limit-by-ip';

// Redis is absent in the test env → the limiter uses the in-memory store.

function req(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('createIpLimiter (API-01)', () => {
  it('allows up to `max` requests per IP per window, then 429s', async () => {
    const limiter = createIpLimiter({
      bucket: `test:${Math.random()}`,
      windowMs: 60_000,
      max: 2,
      code: 'TOO_MANY_REQUESTS',
      message: 'slow down',
    });

    expect(await limiter.check(req('1.1.1.1'))).toBeNull();
    expect(await limiter.check(req('1.1.1.1'))).toBeNull();
    const blocked = await limiter.check(req('1.1.1.1'));
    expect(blocked?.status).toBe(429);
    const body = await blocked!.json();
    expect(body.error).toBe('TOO_MANY_REQUESTS');
    expect(blocked!.headers.get('Retry-After')).toBeTruthy();
  });

  it('keys per-IP — a different IP has its own budget', async () => {
    const limiter = createIpLimiter({
      bucket: `test:${Math.random()}`,
      windowMs: 60_000,
      max: 1,
      code: 'TOO_MANY_REQUESTS',
      message: 'slow down',
    });

    expect(await limiter.check(req('2.2.2.2'))).toBeNull();
    expect((await limiter.check(req('2.2.2.2')))?.status).toBe(429);
    expect(await limiter.check(req('3.3.3.3'))).toBeNull(); // fresh bucket
  });
});
