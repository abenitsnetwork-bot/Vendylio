/**
 * API-01 (Prompt #15) — per-IP rate limit for PUBLIC, guest-accessible
 * endpoints that have no user/email to key on: checkout (`POST /api/orders`),
 * cart validation, delivery quotes, guest order tracking.
 *
 * These already require a (guest-safe) CSRF token, but that doesn't stop a
 * script that mints one and then hammers the route — burning provider quote
 * budget or piling up PENDING orders + Stripe sessions. A coarse per-IP bucket
 * closes that gap without affecting a real shopper (the limits are generous).
 *
 * Same backing store + degraded-mode posture as `rate-limit-by-email.ts`:
 * Upstash Redis when available, in-memory (per-instance, logged) otherwise;
 * `AUTH_RATE_LIMIT_FAIL_CLOSED=1` makes it 503 rather than rely on the fallback.
 */
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { redis } from '../redis';
import {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  type RateLimitStore,
} from '../rate-limit-store';
import { log } from '../observability/log';

export interface IpLimiterConfig {
  bucket: string;
  windowMs: number;
  max: number;
  code: string;
  message: string;
}

export interface IpLimiter {
  check(req: NextRequest): Promise<NextResponse | null>;
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function createIpLimiter(config: IpLimiterConfig): IpLimiter {
  const failClosed = process.env.AUTH_RATE_LIMIT_FAIL_CLOSED === '1';

  if (!redis) {
    log.warn(
      `ip-limiter using in-memory fallback (Redis absent) bucket=${config.bucket} ` +
        `failClosed=${failClosed ? '1' : '0'}`,
    );
  }

  const store: RateLimitStore = redis
    ? new RedisRateLimitStore({ redis, prefix: `rl:${config.bucket}:`, windowMs: config.windowMs })
    : new MemoryRateLimitStore({ windowMs: config.windowMs });

  return {
    async check(req) {
      if (failClosed && !redis) {
        return NextResponse.json(
          {
            error: 'RATE_LIMIT_UNAVAILABLE',
            message: 'Rate limiter unavailable. Try again shortly.',
          },
          { status: 503, headers: { 'Retry-After': '30' } },
        );
      }
      const { totalHits, resetTime } = await store.increment(`ip:${clientIp(req)}`);
      if (totalHits > config.max) {
        const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        return NextResponse.json(
          { error: config.code, message: config.message },
          {
            status: 429,
            headers: {
              'Retry-After': String(retryAfter),
              'X-RateLimit-Limit': String(config.max),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(Math.ceil(resetTime.getTime() / 1000)),
            },
          },
        );
      }
      return null;
    },
  };
}

/**
 * Shared limiter instances for the public storefront/checkout surface. Windows
 * are 1 minute; the maxes are well above any real shopper's cadence. Override
 * with the env knobs for a fork with unusual traffic.
 */
export const checkoutIpLimiter = createIpLimiter({
  bucket: 'pub:checkout',
  windowMs: 60_000,
  max: Number(process.env.CHECKOUT_IP_RATE_LIMIT_MAX ?? 12),
  code: 'TOO_MANY_REQUESTS',
  message: 'Too many checkout attempts. Wait a minute and try again.',
});

export const quoteIpLimiter = createIpLimiter({
  bucket: 'pub:quote',
  windowMs: 60_000,
  max: Number(process.env.QUOTE_IP_RATE_LIMIT_MAX ?? 30),
  code: 'TOO_MANY_REQUESTS',
  message: 'Too many delivery-quote requests. Wait a minute and try again.',
});

export const trackingIpLimiter = createIpLimiter({
  bucket: 'pub:tracking',
  windowMs: 60_000,
  max: Number(process.env.TRACKING_IP_RATE_LIMIT_MAX ?? 60),
  code: 'TOO_MANY_REQUESTS',
  message: 'Too many requests. Wait a minute and try again.',
});

// Phase 4a — the storefront analytics beacon (`POST /api/track`). Fires once
// per storefront / product page view; the cap is well above a real visitor's
// browsing cadence and just bounds a script hammering the counter endpoint.
export const storefrontViewIpLimiter = createIpLimiter({
  bucket: 'pub:view',
  windowMs: 60_000,
  max: Number(process.env.VIEW_IP_RATE_LIMIT_MAX ?? 60),
  code: 'TOO_MANY_REQUESTS',
  message: 'Too many requests. Wait a minute and try again.',
});

// Phase 5 — the public "Business" waitlist form on /pricing (`POST
// /api/business-waitlist`). A real person submits it once; the cap just stops
// a script filling the BusinessLead table.
export const leadIpLimiter = createIpLimiter({
  bucket: 'pub:lead',
  windowMs: 60_000,
  max: Number(process.env.LEAD_IP_RATE_LIMIT_MAX ?? 5),
  code: 'TOO_MANY_REQUESTS',
  message: 'Too many submissions. Wait a minute and try again.',
});
