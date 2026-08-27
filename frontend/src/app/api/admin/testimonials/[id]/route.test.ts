import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedSuperadmin } from '@/test-utils/admin-fixtures';

vi.mock('@/lib/server/middleware', () => ({
  requireSuperadmin: vi.fn(),
}));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({
  logAdminAction: vi.fn(),
}));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { PATCH, DELETE } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

const EXISTING = {
  id: 't1',
  name: 'Adaeze O.',
  location: 'Maryland',
  detail: 'Shea butter',
  quote: 'Great platform.',
  avatarUrl: null,
  rating: 5,
  sortOrder: 0,
  visible: true,
};

function makeReq(
  method: 'PATCH' | 'DELETE',
  body: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/testimonials/t1', {
    method,
    headers,
    ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}),
  });
}

function ctxWith(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.testimonial.findUnique.mockResolvedValue(EXISTING as never);
});

describe('PATCH /api/admin/testimonials/[id]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq('PATCH', { visible: false }, 'missing'), ctxWith('t1'));
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'SUPERADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PATCH(makeReq('PATCH', { visible: false }), ctxWith('t1'));
    expect(res.status).toBe(403);
  });

  it('404s TESTIMONIAL_NOT_FOUND when the row does not exist', async () => {
    prismaMock.testimonial.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(makeReq('PATCH', { visible: false }), ctxWith('missing'));
    expect(res.status).toBe(404);
  });

  it('400s VALIDATION_FAILED on an out-of-range rating', async () => {
    const res = await PATCH(makeReq('PATCH', { rating: 9 }), ctxWith('t1'));
    expect(res.status).toBe(400);
  });

  it('toggles visible and logs the action', async () => {
    prismaMock.testimonial.update.mockResolvedValueOnce({
      ...EXISTING,
      visible: false,
    } as never);

    const res = await PATCH(makeReq('PATCH', { visible: false }), ctxWith('t1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.testimonial.visible).toBe(false);

    expect(prismaMock.testimonial.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { visible: false },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actor.id,
        action: 'testimonial.update',
        targetType: 'Testimonial',
        targetId: 't1',
      }),
    );
  });

  it('updates sortOrder for drag-to-reorder', async () => {
    prismaMock.testimonial.update.mockResolvedValueOnce({ ...EXISTING, sortOrder: 3 } as never);
    await PATCH(makeReq('PATCH', { sortOrder: 3 }), ctxWith('t1'));
    expect(prismaMock.testimonial.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { sortOrder: 3 },
    });
  });
});

describe('DELETE /api/admin/testimonials/[id]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await DELETE(makeReq('DELETE', undefined, 'missing'), ctxWith('t1'));
    expect(res.status).toBe(403);
  });

  it('404s TESTIMONIAL_NOT_FOUND when the row does not exist', async () => {
    prismaMock.testimonial.findUnique.mockResolvedValueOnce(null);
    const res = await DELETE(makeReq('DELETE', undefined), ctxWith('missing'));
    expect(res.status).toBe(404);
    expect(prismaMock.testimonial.delete).not.toHaveBeenCalled();
  });

  it('deletes the testimonial and logs the action', async () => {
    const res = await DELETE(makeReq('DELETE', undefined), ctxWith('t1'));
    expect(res.status).toBe(200);
    expect(prismaMock.testimonial.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actor.id,
        action: 'testimonial.delete',
        targetType: 'Testimonial',
        targetId: 't1',
      }),
    );
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
