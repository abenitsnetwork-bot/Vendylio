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
  return new NextRequest('http://test/api/admin/site-videos/landing_hero_video', {
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
  return new NextRequest('http://test/api/admin/site-videos/landing_hero_video', {
    method: 'DELETE',
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('PUT /api/admin/site-videos/[key]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PUT(
      makeReq({ url: 'https://cdn/x.mp4' }, 'missing'),
      ctxWith('landing_hero_video'),
    );
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'SUPERADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PUT(makeReq({ url: 'https://cdn/x.mp4' }), ctxWith('landing_hero_video'));
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await PUT(makeReq({ url: 'https://cdn/x.mp4' }), ctxWith('landing_hero_video'));
    expect(res.status).toBe(429);
  });

  it('404s UNKNOWN_SITE_VIDEO_KEY on an unrecognized key', async () => {
    const res = await PUT(makeReq({ url: 'https://cdn/x.mp4' }), ctxWith('not_a_real_slot'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('UNKNOWN_SITE_VIDEO_KEY');
    expect(prismaMock.siteVideo.upsert).not.toHaveBeenCalled();
  });

  it('400s VALIDATION_FAILED on a non-URL value', async () => {
    const res = await PUT(makeReq({ url: 'not-a-url' }), ctxWith('landing_hero_video'));
    expect(res.status).toBe(400);
  });

  it('upserts the video and logs the admin action', async () => {
    prismaMock.siteVideo.upsert.mockResolvedValueOnce({
      key: 'landing_hero_video',
      url: 'https://cdn/video.mp4',
      posterUrl: 'https://cdn/poster.jpg',
      updatedAt: new Date('2026-01-01'),
    } as never);

    const res = await PUT(
      makeReq({ url: 'https://cdn/video.mp4', posterUrl: 'https://cdn/poster.jpg' }),
      ctxWith('landing_hero_video'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.video.url).toBe('https://cdn/video.mp4');

    expect(prismaMock.siteVideo.upsert).toHaveBeenCalledWith({
      where: { key: 'landing_hero_video' },
      create: {
        key: 'landing_hero_video',
        url: 'https://cdn/video.mp4',
        posterUrl: 'https://cdn/poster.jpg',
      },
      update: { url: 'https://cdn/video.mp4', posterUrl: 'https://cdn/poster.jpg' },
      select: { key: true, url: true, posterUrl: true, updatedAt: true },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actor.id,
        action: 'site_video.update',
        targetType: 'SiteVideo',
        targetId: 'landing_hero_video',
      }),
    );
  });
});

describe('DELETE /api/admin/site-videos/[key]', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await DELETE(makeDeleteReq('missing'), ctxWith('landing_hero_video'));
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('404s UNKNOWN_SITE_VIDEO_KEY on an unrecognized key', async () => {
    const res = await DELETE(makeDeleteReq(), ctxWith('not_a_real_slot'));
    expect(res.status).toBe(404);
    expect(prismaMock.siteVideo.deleteMany).not.toHaveBeenCalled();
  });

  it('clears the slot via deleteMany (no-op-safe) and logs the action', async () => {
    const res = await DELETE(makeDeleteReq(), ctxWith('landing_hero_video'));
    expect(res.status).toBe(200);
    expect(prismaMock.siteVideo.deleteMany).toHaveBeenCalledWith({
      where: { key: 'landing_hero_video' },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actor.id,
        action: 'site_video.clear',
        targetType: 'SiteVideo',
        targetId: 'landing_hero_video',
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
