import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
  return new NextRequest('http://test/api/stores/publish', { method: 'POST', headers });
}

const draftStore = {
  id: 'store-1',
  name: "Adaeze's Shea Butter",
  published: false,
  publishedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue(draftStore as never);
  prismaMock.product.count.mockResolvedValue(2);
  prismaMock.store.update.mockImplementation((async ({
    data,
  }: {
    data: Record<string, unknown>;
  }) => ({
    ...draftStore,
    ...data,
  })) as never);
});

describe('POST /api/stores/publish', () => {
  it('403s without the CSRF header', async () => {
    expect((await POST(makePost('missing'))).status).toBe(403);
    expect(mockResolveOwnStore).not.toHaveBeenCalled();
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await POST(makePost())).status).toBe(401);
  });

  it('404s NO_STORE when the caller has no store', async () => {
    mockResolveOwnStore.mockResolvedValueOnce(null);
    const res = await POST(makePost());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NO_STORE');
  });

  it('400s NOT_READY_TO_PUBLISH when there is no active product', async () => {
    prismaMock.product.count.mockResolvedValueOnce(0);
    const res = await POST(makePost());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('NOT_READY_TO_PUBLISH');
    expect(body.missing).toContain('ACTIVE_PRODUCT');
    expect(prismaMock.store.update).not.toHaveBeenCalled();
  });

  it('publishes the store and stamps publishedAt', async () => {
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.store.published).toBe(true);
    const call = prismaMock.store.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { published: boolean; publishedAt: Date };
    };
    expect(call.where).toEqual({ id: 'store-1' });
    expect(call.data.published).toBe(true);
    expect(call.data.publishedAt).toBeInstanceOf(Date);
  });

  it('is an idempotent no-op when the store is already published', async () => {
    mockResolveOwnStore.mockResolvedValueOnce({
      ...draftStore,
      published: true,
      publishedAt: new Date('2026-01-01'),
    } as never);
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyPublished).toBe(true);
    expect(prismaMock.product.count).not.toHaveBeenCalled();
    expect(prismaMock.store.update).not.toHaveBeenCalled();
  });

  it('keeps the original publishedAt when re-publishing a previously-launched store', async () => {
    const firstLaunch = new Date('2026-01-01T00:00:00Z');
    mockResolveOwnStore.mockResolvedValueOnce({
      ...draftStore,
      published: false,
      publishedAt: firstLaunch,
    } as never);
    await POST(makePost());
    const call = prismaMock.store.update.mock.calls[0]?.[0] as {
      data: { publishedAt: Date };
    };
    expect(call.data.publishedAt).toEqual(firstLaunch);
  });
});
