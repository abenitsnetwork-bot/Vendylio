import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makePost(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') headers['x-csrf-token'] = 'csrf-tok';
  return new NextRequest('http://test/api/stores/unpublish', { method: 'POST', headers });
}

const liveStore = { id: 'store-1', published: true, publishedAt: new Date('2026-01-01') };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue(liveStore as never);
  prismaMock.store.update.mockResolvedValue({ ...liveStore, published: false } as never);
});

describe('POST /api/stores/unpublish', () => {
  it('403s without the CSRF header', async () => {
    expect((await POST(makePost('missing'))).status).toBe(403);
  });

  it('404s NO_STORE when the caller has no store', async () => {
    mockResolveOwnStore.mockResolvedValueOnce(null);
    expect((await POST(makePost())).status).toBe(404);
  });

  it('takes a live store offline but leaves publishedAt intact', async () => {
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    expect((await res.json()).store.published).toBe(false);
    expect(prismaMock.store.update).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { published: false },
    });
  });

  it('is an idempotent no-op when the store is already a draft', async () => {
    mockResolveOwnStore.mockResolvedValueOnce({ ...liveStore, published: false } as never);
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyUnpublished).toBe(true);
    expect(prismaMock.store.update).not.toHaveBeenCalled();
  });
});
