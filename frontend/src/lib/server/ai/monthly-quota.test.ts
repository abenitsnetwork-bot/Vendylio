import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const store = new Map<string, number>();
  const redisMock = {
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    incr: vi.fn(async (k: string) => {
      const n = (store.get(k) ?? 0) + 1;
      store.set(k, n);
      return n;
    }),
    expire: vi.fn(async () => 1),
  };
  return { store, redisMock, ref: { current: redisMock as unknown as object | null } };
});

vi.mock('@/lib/server/redis', () => ({
  get redis() {
    return h.ref.current;
  },
}));

import { peekAiQuota, consumeAiQuota } from './monthly-quota';

beforeEach(() => {
  h.store.clear();
  vi.clearAllMocks();
  h.ref.current = h.redisMock as unknown as object;
});

describe('peekAiQuota', () => {
  it('unlimited (Pro, limit null) → always ok, never reads Redis', async () => {
    const s = await peekAiQuota('u1', null);
    expect(s).toEqual({ ok: true, used: 0, limit: null });
    expect(h.redisMock.get).not.toHaveBeenCalled();
  });

  it('ok while under the limit', async () => {
    h.store.set('ai:quota:u1:2026-09', 3);
    const s = await peekAiQuota('u1', 5, new Date('2026-09-15T00:00:00Z'));
    expect(s).toEqual({ ok: true, used: 3, limit: 5 });
  });

  it('not ok at the limit', async () => {
    h.store.set('ai:quota:u1:2026-09', 5);
    const s = await peekAiQuota('u1', 5, new Date('2026-09-15T00:00:00Z'));
    expect(s.ok).toBe(false);
  });

  it('redis absent → not enforced (ok)', async () => {
    h.ref.current = null;
    const s = await peekAiQuota('u1', 5);
    expect(s.ok).toBe(true);
  });
});

describe('consumeAiQuota', () => {
  it('increments the month counter and sets a TTL on first use', async () => {
    await consumeAiQuota('u1', 5, new Date('2026-09-15T00:00:00Z'));
    expect(h.store.get('ai:quota:u1:2026-09')).toBe(1);
    expect(h.redisMock.expire).toHaveBeenCalledTimes(1);
  });

  it('does not set TTL again on subsequent increments', async () => {
    h.store.set('ai:quota:u1:2026-09', 2);
    await consumeAiQuota('u1', 5, new Date('2026-09-15T00:00:00Z'));
    expect(h.store.get('ai:quota:u1:2026-09')).toBe(3);
    expect(h.redisMock.expire).not.toHaveBeenCalled();
  });

  it('no-op for unlimited plans', async () => {
    await consumeAiQuota('u1', null);
    expect(h.redisMock.incr).not.toHaveBeenCalled();
  });
});
