// Per-userId rate limit for POST /api/ai/generate-description. Each call is
// a billed Anthropic API request, so this budget exists to cap cost from a
// single compromised/abusive session — not a security boundary like the
// admin rate limiter it mirrors (rate-limit-by-userid.ts).
//
// WR-03 spirit — fail-closed semantics in production. When `redis === null`
// (UPSTASH env missing) we fail OPEN in dev/CI so local development still
// works, but fail CLOSED with 503 in production so a misconfigured deploy
// doesn't silently remove the cost cap.
import 'server-only';
import { NextResponse } from 'next/server';
import { redis } from '@/lib/server/redis';
import { RedisRateLimitStore } from '@/lib/server/rate-limit-store';

const AI_PREFIX = 'rl:ai:userid:';
const WINDOW_MS = 60 * 60_000; // 1 hour
const MAX_HITS = 20;

/**
 * Enforce the per-userId AI generation rate limit. Returns a 429
 * NextResponse when the userId has exceeded MAX_HITS in WINDOW_MS, otherwise
 * returns null and the caller should proceed.
 */
export async function enforceAiRateLimit(userId: string): Promise<NextResponse | null> {
  if (!redis) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        {
          error: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
          message: 'Rate-limit backend unavailable.',
        },
        { status: 503 },
      );
    }
    return null;
  }
  const store = new RedisRateLimitStore({ redis, prefix: '', windowMs: WINDOW_MS });
  const { totalHits, resetTime } = await store.increment(`${AI_PREFIX}${userId}`);
  if (totalHits > MAX_HITS) {
    const retryAfter = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    return NextResponse.json(
      {
        error: 'TOO_MANY_REQUESTS',
        message: 'AI generation rate limit exceeded; retry shortly.',
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(MAX_HITS),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(resetTime.getTime() / 1000)),
        },
      },
    );
  }
  return null;
}
