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

  it('400s VALIDATION_FAILED on an invalid category enum value', async () => {
    const res = await POST(makePost({ kind: 'product', name: 'Shea Butter', category: 'MADE_UP' }));
    expect(res.status).toBe(400);
  });

  it('generates a product description and passes the parsed fields through', async () => {
    mockGenerate.mockResolvedValueOnce('Rich, hand-whipped shea butter from local cooperatives.');
    const res = await POST(
      makePost({
        kind: 'product',
        name: 'Shea Butter',
        category: 'BEAUTY_PERSONAL_CARE',
        unit: 'KG',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.description).toBe('Rich, hand-whipped shea butter from local cooperatives.');
    expect(mockGenerate).toHaveBeenCalledWith({
      kind: 'product',
      name: 'Shea Butter',
      category: 'BEAUTY_PERSONAL_CARE',
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
