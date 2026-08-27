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

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { GET } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/admin/site-images', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.siteImage.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/site-images', () => {
  it('propagates 403 from requireSuperadmin (plain ADMIN cannot access)', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'SUPERADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(403);
  });

  it('propagates 429 from the rate limiter', async () => {
    mockRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(429);
  });

  it('returns the full manifest with url:null for every slot when nothing is set', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.images).toHaveLength(5);
    expect(body.images.every((img: { url: null }) => img.url === null)).toBe(true);
    expect(body.images.map((img: { key: string }) => img.key)).toContain('hero_showcase');
  });

  it('merges an existing SiteImage row into its manifest slot', async () => {
    prismaMock.siteImage.findMany.mockResolvedValueOnce([
      {
        key: 'hero_showcase',
        url: 'https://cdn/hero.jpg',
        altText: 'Sellers',
        updatedAt: new Date('2026-01-01'),
      },
    ] as never);

    const res = await GET(makeGet());
    const body = await res.json();
    const hero = body.images.find((img: { key: string }) => img.key === 'hero_showcase');
    expect(hero.url).toBe('https://cdn/hero.jpg');
    expect(hero.altText).toBe('Sellers');
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
