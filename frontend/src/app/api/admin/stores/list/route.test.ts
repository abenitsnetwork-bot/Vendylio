import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({ enforceAdminRateLimit: vi.fn() }));

import { requireAdmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const adminCtx = {
  user: { sub: 'a1', email: 'a@t.local' },
  admin: { id: 'a1', email: 'a@t.local', role: 'ADMIN' as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(adminCtx);
  vi.mocked(enforceAdminRateLimit).mockResolvedValue(null);
});

const req = () => new NextRequest('http://test/api/admin/stores/list', { method: 'GET' });

describe('GET /api/admin/stores/list', () => {
  it('propagates 403 from requireAdmin', async () => {
    vi.mocked(requireAdmin).mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    expect((await GET(req())).status).toBe(403);
    expect(prismaMock.store.findMany).not.toHaveBeenCalled();
  });

  it('returns every store name-sorted with the minimal shape', async () => {
    prismaMock.store.findMany.mockResolvedValueOnce([
      { id: 's1', name: 'Ada', slug: 'ada', published: true },
      { id: 's2', name: 'Bea', slug: 'bea', published: false },
    ] as never);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).stores).toHaveLength(2);
    expect(prismaMock.store.findMany.mock.calls[0]?.[0]?.orderBy).toEqual({ name: 'asc' });
  });
});
