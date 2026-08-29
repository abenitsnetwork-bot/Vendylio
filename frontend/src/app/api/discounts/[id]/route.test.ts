import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { PATCH, DELETE } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeReq(method: 'PATCH' | 'DELETE', body?: unknown, csrf: 'match' | 'missing' = 'match') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/discounts/d1', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
});

describe('PATCH /api/discounts/[id]', () => {
  it('404s when the code belongs to another store', async () => {
    prismaMock.discount.findFirst.mockResolvedValueOnce(null);
    const res = await PATCH(makeReq('PATCH', { active: false }), params('d1'));
    expect(res.status).toBe(404);
  });

  it('toggles active', async () => {
    prismaMock.discount.findFirst.mockResolvedValueOnce({
      id: 'd1',
      startsAt: null,
      endsAt: null,
    } as never);
    prismaMock.discount.update.mockResolvedValueOnce({ id: 'd1', active: false } as never);

    const res = await PATCH(makeReq('PATCH', { active: false }), params('d1'));
    expect(res.status).toBe(200);
    expect(prismaMock.discount.update.mock.calls[0]?.[0]?.data).toEqual({ active: false });
  });

  it('rejects a merged window where end is before start', async () => {
    prismaMock.discount.findFirst.mockResolvedValueOnce({
      id: 'd1',
      startsAt: new Date('2026-12-20T00:00:00Z'),
      endsAt: null,
    } as never);

    const res = await PATCH(makeReq('PATCH', { endsAt: '2026-12-01T00:00:00Z' }), params('d1'));
    expect(res.status).toBe(400);
  });

  it('uppercases a renamed code', async () => {
    prismaMock.discount.findFirst.mockResolvedValueOnce({
      id: 'd1',
      startsAt: null,
      endsAt: null,
    } as never);
    prismaMock.discount.update.mockResolvedValueOnce({ id: 'd1', code: 'SPRING' } as never);

    await PATCH(makeReq('PATCH', { code: 'spring' }), params('d1'));
    expect(prismaMock.discount.update.mock.calls[0]?.[0]?.data).toMatchObject({ code: 'SPRING' });
  });
});

describe('DELETE /api/discounts/[id]', () => {
  it('404s when not the caller’s', async () => {
    prismaMock.discount.findFirst.mockResolvedValueOnce(null);
    expect((await DELETE(makeReq('DELETE'), params('d1'))).status).toBe(404);
  });

  it('deletes an owned code', async () => {
    prismaMock.discount.findFirst.mockResolvedValueOnce({
      id: 'd1',
      startsAt: null,
      endsAt: null,
    } as never);
    prismaMock.discount.delete.mockResolvedValueOnce({ id: 'd1' } as never);

    const res = await DELETE(makeReq('DELETE'), params('d1'));
    expect(res.status).toBe(200);
    expect(prismaMock.discount.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });
});
