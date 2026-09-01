// Phase 3 — per-merchant monthly AI-generation quota.
//
// `planFeatures(plan).aiMonthlyQuota` is the ceiling: 5/month on Free, null
// (unlimited) on Pro. This is a soft cost cap, NOT a security boundary — it
// layers on top of the per-hour abuse limiter in `ai/rate-limit.ts`.
//
// Counter: a plain Redis integer keyed by userId + calendar month
// (`ai:quota:<userId>:<YYYY-MM>`), TTL ~40 days so it self-expires. We PEEK
// before the (billed) generation and only CONSUME after it succeeds, so a
// failed Anthropic call never burns a merchant's quota.
//
// Redis absent (local dev / CI): quota is not enforced — `peek` returns ok and
// `consume` is a no-op. The AI route's per-hour limiter already fails closed
// in production when Redis is missing, so this path only runs with Redis up.
import 'server-only';
import { redis } from '@/lib/server/redis';

const PREFIX = 'ai:quota:';
const TTL_SECONDS = 40 * 24 * 60 * 60;

function monthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function keyFor(userId: string, now?: Date): string {
  return `${PREFIX}${userId}:${monthKey(now)}`;
}

export interface QuotaState {
  ok: boolean;
  used: number;
  /** null = unlimited (Pro). */
  limit: number | null;
}

/**
 * Check whether `userId` may run one more generation this month. Does not
 * mutate the counter — call `consumeAiQuota` after a successful generation.
 */
export async function peekAiQuota(
  userId: string,
  limit: number | null,
  now?: Date,
): Promise<QuotaState> {
  if (limit === null || !redis) return { ok: true, used: 0, limit };
  const raw = await redis.get<number>(keyFor(userId, now));
  const used = typeof raw === 'number' ? raw : Number(raw ?? 0);
  return { ok: used < limit, used, limit };
}

/** Record one successful generation against this month's counter. */
export async function consumeAiQuota(
  userId: string,
  limit: number | null,
  now?: Date,
): Promise<void> {
  if (limit === null || !redis) return;
  const key = keyFor(userId, now);
  const next = await redis.incr(key);
  if (next === 1) await redis.expire(key, TTL_SECONDS);
}
