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
import { GET, POST } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actor = seedSuperadmin({ id: 'superadmin_1' });
const actorCtx = {
  user: { sub: actor.id, email: actor.email },
  admin: { id: actor.id, email: actor.email, role: 'SUPERADMIN' as const },
};

function makeGet(): NextRequest {
  return new NextRequest('http://test/api/admin/testimonials', { method: 'GET' });
}

function makePost(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/testimonials', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
  prismaMock.testimonial.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/testimonials', () => {
  it('propagates 403 from requireSuperadmin', async () => {
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

  it('lists all testimonials (including hidden ones) ordered by sortOrder', async () => {
    await GET(makeGet());
    expect(prismaMock.testimonial.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  });
});

describe('POST /api/admin/testimonials', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost({ name: 'A', quote: 'q' }, 'missing'));
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('400s VALIDATION_FAILED on a missing quote', async () => {
    const res = await POST(makePost({ name: 'A' }));
    expect(res.status).toBe(400);
  });

  it('creates a testimonial defaulting visible:true and sortOrder:0, and logs the action', async () => {
    prismaMock.testimonial.create.mockResolvedValueOnce({
      id: 't1',
      name: 'Adaeze O.',
      location: 'Maryland',
      detail: 'Shea butter',
      quote: 'Great platform.',
      avatarUrl: null,
      rating: 5,
      sortOrder: 0,
      visible: true,
    } as never);

    const res = await POST(
      makePost({
        name: 'Adaeze O.',
        location: 'Maryland',
        detail: 'Shea butter',
        quote: 'Great platform.',
        rating: 5,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.testimonial.id).toBe('t1');

    expect(prismaMock.testimonial.create).toHaveBeenCalledWith({
      data: {
        name: 'Adaeze O.',
        location: 'Maryland',
        detail: 'Shea butter',
        quote: 'Great platform.',
        avatarUrl: null,
        rating: 5,
        sortOrder: 0,
      },
    });
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: actor.id,
        action: 'testimonial.create',
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
