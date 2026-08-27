import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };
const ctx = { params: Promise.resolve({ id: 'rev-1' }) };
const REVIEW = { id: 'rev-1', storeId: 'store-1', rating: 5, text: 'Great!', visible: true };

function makeReq(body?: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/reviews/rev-1', {
    method: 'PATCH',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
  prismaMock.review.findFirst.mockResolvedValue(REVIEW as never);
});

describe('PATCH /api/reviews/[id]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq({ visible: false }, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await PATCH(makeReq({ visible: false }), ctx);
    expect(res.status).toBe(401);
  });

  it('404s REVIEW_NOT_FOUND when the caller has no store', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await PATCH(makeReq({ visible: false }), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('REVIEW_NOT_FOUND');
  });

  it("404s REVIEW_NOT_FOUND when the review belongs to another seller's store", async () => {
    prismaMock.review.findFirst.mockResolvedValue(null);
    const res = await PATCH(makeReq({ visible: false }), ctx);
    expect(res.status).toBe(404);
    const args = prismaMock.review.findFirst.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ id: 'rev-1', storeId: 'store-1' });
  });

  it('400s on invalid body', async () => {
    const res = await PATCH(makeReq({ visible: 'nope' }), ctx);
    expect(res.status).toBe(400);
  });

  it('toggles visible and never lets the seller edit rating/text', async () => {
    prismaMock.review.update.mockResolvedValue({ ...REVIEW, visible: false } as never);
    const res = await PATCH(makeReq({ visible: false, rating: 1, text: 'edited' }), ctx);
    expect(res.status).toBe(200);
    const updateArg = prismaMock.review.update.mock.calls[0]?.[0];
    expect(updateArg?.where).toEqual({ id: 'rev-1' });
    expect(updateArg?.data).toEqual({ visible: false });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
