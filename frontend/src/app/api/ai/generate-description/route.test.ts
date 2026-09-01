// Phase 11 — POST /api/ai/generate-description.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/ai/rate-limit', () => ({
  enforceAiRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/ai/generate-description', () => {
  class AiNotConfiguredError extends Error {}
  return {
    AiNotConfiguredError,
    generateDescription: vi.fn(),
  };
});
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn(async () => ({ plan: 'FREE' })) }));
const peekAiQuota = vi.fn(async () => ({ ok: true, used: 0, limit: 5 }));
const consumeAiQuota = vi.fn(async () => {});
vi.mock('@/lib/server/ai/monthly-quota', () => ({
  peekAiQuota: (...a: unknown[]) => peekAiQuota(...(a as [])),
  consumeAiQuota: (...a: unknown[]) => consumeAiQuota(...(a as [])),
}));

import { requireAuth } from '@/lib/server/middleware';
import { enforceAiRateLimit } from '@/lib/server/ai/rate-limit';
import { AiNotConfiguredError, generateDescription } from '@/lib/server/ai/generate-description';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockRateLimit = vi.mocked(enforceAiRateLimit);
const mockGenerate = vi.mocked(generateDescription);

const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makePost(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/ai/generate-description', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockRateLimit.mockResolvedValue(null);
  peekAiQuota.mockResolvedValue({ ok: true, used: 0, limit: 5 });
});

describe('POST /api/ai/generate-description', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter' }, 'missing'));
    expect(res.status).toBe(403);
    expect(mockRequireAuth).not.toHaveBeenCalled();
  });

  it('propagates 401 from requireAuth', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter' }));
    expect(res.status).toBe(401);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter' }));
    expect(res.status).toBe(429);
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('400s VALIDATION_FAILED on a missing name', async () => {
    const res = await POST(makePost({ kind: 'product' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('400s VALIDATION_FAILED on an unknown kind', async () => {
    const res = await POST(makePost({ kind: 'widget', name: 'x' }));
    expect(res.status).toBe(400);
  });

  it('400s VALIDATION_FAILED on a blank category string', async () => {
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter', category: '' }));
    expect(res.status).toBe(400);
  });

  it('generates a product description and passes the parsed fields through', async () => {
    mockGenerate.mockResolvedValueOnce('Rich, hand-whipped shea butter from local cooperatives.');
    const res = await POST(
      makePost({
        kind: 'product',
        name: 'Shea Butter',
        category: 'Beauty & Personal Care',
        unit: 'KG',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.description).toBe('Rich, hand-whipped shea butter from local cooperatives.');
    expect(mockGenerate).toHaveBeenCalledWith({
      kind: 'product',
      name: 'Shea Butter',
      category: 'Beauty & Personal Care',
      unit: 'KG',
    });
  });

  it('generates a store description', async () => {
    mockGenerate.mockResolvedValueOnce('Welcome to our little corner of Maryland.');
    const res = await POST(
      makePost({ kind: 'store', name: "Adaeze's Shop", city: 'Maryland', state: 'MD' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.description).toBe('Welcome to our little corner of Maryland.');
  });

  it('503s AI_NOT_CONFIGURED when the AI client is unconfigured', async () => {
    mockGenerate.mockRejectedValueOnce(new AiNotConfiguredError());
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter' }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('502s AI_GENERATION_FAILED on any other generation error', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('upstream boom'));
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('AI_GENERATION_FAILED');
  });

  // Phase 3 — monthly quota.
  it('402 AI_QUOTA_EXCEEDED when the FREE monthly quota is spent', async () => {
    peekAiQuota.mockResolvedValueOnce({ ok: false, used: 5, limit: 5 });
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter' }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('AI_QUOTA_EXCEEDED');
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(consumeAiQuota).not.toHaveBeenCalled();
  });

  it('consumes one quota unit only after a successful generation', async () => {
    mockGenerate.mockResolvedValueOnce('desc');
    await POST(makePost({ kind: 'product', name: 'Shea Butter' }));
    expect(consumeAiQuota).toHaveBeenCalledTimes(1);
  });

  it('does NOT consume quota when generation fails', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom'));
    await POST(makePost({ kind: 'product', name: 'Shea Butter' }));
    expect(consumeAiQuota).not.toHaveBeenCalled();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs', withRequestContext and verifyCsrf", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
    expect(src).toContain('verifyCsrf');
  });
});
