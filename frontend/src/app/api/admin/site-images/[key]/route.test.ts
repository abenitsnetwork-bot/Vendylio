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
import { PUT, DELETE } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeReq(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/site-images/hero_showcase', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

function ctxWith(key: string): { params: Promise<{ key: string }> } {
  return { params: Promise.resolve({ key }) };
}

function makeDeleteReq(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = {};
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/site-images/hero_showcase', {
    method: 'DELETE',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('PUT /api/admin/site-images/[key]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PUT(
      makeReq({ url: 'https://cdn/x.jpg' }, 'missing'),
      ctxWith('hero_showcase'),
    );
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'SUPERADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PUT(makeReq({ url: 'https://cdn/x.jpg' }), ctxWith('hero_showcase'));
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await PUT(makeReq({ url: 'https://cdn/x.jpg' }), ctxWith('hero_showcase'));
    expect(res.status).toBe(429);
  });

  it('404s UNKNOWN_SITE_IMAGE_KEY on an unrecognized key', async () => {
    const res = await PUT(makeReq({ url: 'https://cdn/x.jpg' }), ctxWith('not_a_real_slot'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('UNKNOWN_SITE_IMAGE_KEY');
    expect(prismaMock.siteImage.upsert).not.toHaveBeenCalled();
  });

  it('400s VALIDATION_FAILED on a non-URL value', async () => {
    const res = await PUT(makeReq({ url: 'not-a-url' }), ctxWith('hero_showcase'));
    expect(res.status).toBe(400);
  });

  it('upserts the image and logs the admin action', async () => {
    prismaMock.siteImage.upsert.mockResolvedValueOnce({
      key: 'hero_showcase',
      url: 'https://cdn/hero.jpg',
      altText: 'New hero',
      updatedAt: new Date('2026-01-01'),
    } as never);

    const res = await PUT(
      makeReq({ url: 'https://cdn/hero.jpg', altText: 'New hero' }),
      ctxWith('hero_showcase'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.image.url).toBe('https://cdn/hero.jpg');

    expect(prismaMock.siteImage.upsert).toHaveBeenCalledWith({
      where: { key: 'hero_showcase' },
      create: { key: 'hero_showcase', url: 'https://cdn/hero.jpg', altText: 'New hero' },
      update: { url: 'https://cdn/hero.jpg', altText: 'New hero' },
      select: { key: true, url: true, altText: true, updatedAt: true },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actor.id,
        action: 'site_image.update',
        targetType: 'SiteImage',
        targetId: 'hero_showcase',
      }),
    );
  });
});

describe('DELETE /api/admin/site-images/[key]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await DELETE(makeDeleteReq('missing'), ctxWith('hero_showcase'));
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('404s UNKNOWN_SITE_IMAGE_KEY on an unrecognized key', async () => {
    const res = await DELETE(makeDeleteReq(), ctxWith('not_a_real_slot'));
    expect(res.status).toBe(404);
    expect(prismaMock.siteImage.deleteMany).not.toHaveBeenCalled();
  });

  it('clears the slot via deleteMany (no-op-safe) and logs the action', async () => {
    const res = await DELETE(makeDeleteReq(), ctxWith('hero_showcase'));
    expect(res.status).toBe(200);
    expect(prismaMock.siteImage.deleteMany).toHaveBeenCalledWith({
      where: { key: 'hero_showcase' },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actor.id,
        action: 'site_image.clear',
        targetType: 'SiteImage',
        targetId: 'hero_showcase',
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
