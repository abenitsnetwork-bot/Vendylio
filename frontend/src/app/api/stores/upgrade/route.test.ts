// Phase 12 — POST /api/stores/upgrade (Free/Pro tiers stub).
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
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);

const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/stores/upgrade', { method: 'POST', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
});

describe('POST /api/stores/upgrade', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost('missing'));
    expect(res.status).toBe(403);
    expect(mockResolveOwnStore).not.toHaveBeenCalled();
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost());
    expect(res.status).toBe(401);
  });

  it('404s NO_STORE when the caller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValueOnce(null);
    const res = await POST(makePost());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('flips a FREE store to PRO', async () => {
    mockResolveOwnStore.mockResolvedValueOnce({ id: 'store-1', plan: 'FREE' } as never);
    prismaMock.store.update.mockResolvedValueOnce({ id: 'store-1', plan: 'PRO' } as never);

    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store).toEqual({ id: 'store-1', plan: 'PRO' });
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { plan: 'PRO' },
      select: { id: true, plan: true },
    });
  });

  it('is idempotent — a store already on PRO is left alone (no write)', async () => {
    mockResolveOwnStore.mockResolvedValueOnce({ id: 'store-1', plan: 'PRO' } as never);

    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store).toEqual({ id: 'store-1', plan: 'PRO' });
    expect(prismaMock.store.update).not.toHaveBeenCalled();
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
