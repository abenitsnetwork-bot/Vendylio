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
import { GET, PATCH } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

const VALID_PATCH = {
  location: 'Phoenix, Arizona, USA',
  contactEmail: 'hello@vendylio.com',
  websiteUrl: 'https://vendylio.com',
  instagramUrl: 'https://instagram.com/vendylio',
  facebookUrl: '',
  twitterUrl: '',
  tiktokUrl: '',
  linkedinUrl: '',
};

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/admin/site-settings');
}

function makePatch(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/site-settings', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('GET /api/admin/site-settings', () => {
  it('propagates 403 from requireSuperadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
  });

  it('returns the bundled defaults when no row exists yet', async () => {
    prismaMock.siteSettings.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      location: 'Phoenix, Arizona, USA',
      contactEmail: 'no-reply@vendylio.com',
      instagramUrl: null,
    });
  });

  it('returns stored values, falling back per-field for anything left null', async () => {
    prismaMock.siteSettings.findUnique.mockResolvedValueOnce({
      id: 'default',
      location: 'Austin, Texas, USA',
      contactEmail: null,
      websiteUrl: 'https://vendylio.com',
      instagramUrl: 'https://instagram.com/vendylio',
      facebookUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
      updatedAt: new Date(),
    } as never);
    const res = await GET(makeGet());
    const body = await res.json();
    expect(body).toEqual({
      location: 'Austin, Texas, USA',
      contactEmail: 'no-reply@vendylio.com',
      websiteUrl: 'https://vendylio.com',
      instagramUrl: 'https://instagram.com/vendylio',
      facebookUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
    });
  });
});

describe('PATCH /api/admin/site-settings', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makePatch(VALID_PATCH, 'missing'));
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('propagates 403 from requireSuperadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await PATCH(makePatch(VALID_PATCH));
    expect(res.status).toBe(403);
  });

  it('400s VALIDATION_FAILED for a malformed URL', async () => {
    const res = await PATCH(makePatch({ ...VALID_PATCH, instagramUrl: 'not-a-url' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
  });

  it('400s VALIDATION_FAILED for a malformed email', async () => {
    const res = await PATCH(makePatch({ ...VALID_PATCH, contactEmail: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
  });

  it('treats an empty string as clearing the field back to the default', async () => {
    prismaMock.siteSettings.findUnique.mockResolvedValueOnce(null);
    prismaMock.siteSettings.upsert.mockResolvedValueOnce({
      id: 'default',
      location: 'Phoenix, Arizona, USA',
      contactEmail: 'hello@vendylio.com',
      websiteUrl: 'https://vendylio.com',
      instagramUrl: 'https://instagram.com/vendylio',
      facebookUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
      updatedAt: new Date(),
    } as never);

    await PATCH(makePatch(VALID_PATCH));
    const upsertArg = prismaMock.siteSettings.upsert.mock.calls[0]?.[0] as {
      update: { facebookUrl: unknown; twitterUrl: unknown };
    };
    expect(upsertArg.update.facebookUrl).toBeNull();
    expect(upsertArg.update.twitterUrl).toBeNull();
  });

  it('upserts and logs the change with before/after values', async () => {
    prismaMock.siteSettings.findUnique.mockResolvedValueOnce(null);
    prismaMock.siteSettings.upsert.mockResolvedValueOnce({
      id: 'default',
      location: 'Phoenix, Arizona, USA',
      contactEmail: 'hello@vendylio.com',
      websiteUrl: 'https://vendylio.com',
      instagramUrl: 'https://instagram.com/vendylio',
      facebookUrl: null,
      twitterUrl: null,
      tiktokUrl: null,
      linkedinUrl: null,
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(makePatch(VALID_PATCH));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      location: 'Phoenix, Arizona, USA',
      contactEmail: 'hello@vendylio.com',
    });

    expect(mockLogAdminAction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        actorId: actor.id,
        action: 'site_settings.update',
        targetType: 'SiteSettings',
        targetId: 'default',
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
