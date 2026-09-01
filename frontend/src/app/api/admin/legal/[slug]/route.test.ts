import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

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
import { GET, PUT } from './route';

const mockRequireSuperadmin = vi.mocked(requireSuperadmin);
const mockRateLimit = vi.mocked(enforceAdminRateLimit);
const mockLogAdminAction = vi.mocked(logAdminAction);

const actorCtx = {
  user: { sub: 'superadmin_1', email: 'sa@test.local' },
  admin: { id: 'superadmin_1', email: 'sa@test.local', role: 'SUPERADMIN' as const },
};

function ctxWith(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

function makeReq(
  method: 'GET' | 'PUT',
  body?: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/admin/legal/terms', {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSuperadmin.mockResolvedValue(actorCtx);
  mockRateLimit.mockResolvedValue(null);
});

describe('GET /api/admin/legal/[slug]', () => {
  it('propagates 403 from requireSuperadmin', async () => {
    mockRequireSuperadmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }),
    );
    const res = await GET(makeReq('GET'), ctxWith('terms'));
    expect(res.status).toBe(403);
  });

  it('400s on an unknown slug', async () => {
    const res = await GET(makeReq('GET'), ctxWith('cookies'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('UNKNOWN_DOCUMENT');
  });

  it('returns the bundled default when no row exists', async () => {
    prismaMock.legalDocument.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeReq('GET'), ctxWith('privacy'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('privacy');
    expect(body.isDefault).toBe(true);
    expect(body.body.length).toBeGreaterThan(50);
    expect(body.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the stored row when one exists', async () => {
    prismaMock.legalDocument.findUnique.mockResolvedValueOnce({
      slug: 'terms',
      body: '## Custom\n\nHello.',
      version: '2027-01-01',
      updatedAt: new Date('2027-01-01T00:00:00Z'),
      updatedBy: 'superadmin_1',
    } as never);
    const res = await GET(makeReq('GET'), ctxWith('terms'));
    const body = await res.json();
    expect(body.isDefault).toBe(false);
    expect(body.body).toBe('## Custom\n\nHello.');
    expect(body.version).toBe('2027-01-01');
  });
});

describe('PUT /api/admin/legal/[slug]', () => {
  it('403s when the CSRF header is missing', async () => {
    const res = await PUT(
      makeReq('PUT', { body: 'x', version: 'v1' }, 'missing'),
      ctxWith('terms'),
    );
    expect(res.status).toBe(403);
    expect(mockRequireSuperadmin).not.toHaveBeenCalled();
  });

  it('400s on an unknown slug', async () => {
    const res = await PUT(makeReq('PUT', { body: 'x', version: 'v1' }), ctxWith('bogus'));
    expect(res.status).toBe(400);
  });

  it('400s on an oversize body', async () => {
    const res = await PUT(
      makeReq('PUT', { body: 'x'.repeat(50_001), version: 'v1' }),
      ctxWith('terms'),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
  });

  it('400s when version is blank', async () => {
    const res = await PUT(makeReq('PUT', { body: 'hello', version: '   ' }), ctxWith('terms'));
    expect(res.status).toBe(400);
  });

  it('upserts the row and writes a legal.update audit entry', async () => {
    prismaMock.legalDocument.upsert.mockResolvedValueOnce({} as never);
    prismaMock.legalDocument.findUnique.mockResolvedValueOnce({
      slug: 'refund-policy',
      body: '## Updated\n\nText.',
      version: '2026-09-01',
      updatedAt: new Date('2026-09-01T00:00:00Z'),
      updatedBy: 'superadmin_1',
    } as never);

    const res = await PUT(
      makeReq('PUT', { body: '## Updated\n\nText.', version: '2026-09-01' }),
      ctxWith('refund-policy'),
    );
    expect(res.status).toBe(200);

    expect(prismaMock.legalDocument.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'refund-policy' },
        create: expect.objectContaining({ slug: 'refund-policy', version: '2026-09-01' }),
        update: expect.objectContaining({ version: '2026-09-01', updatedBy: 'superadmin_1' }),
      }),
    );
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        actorId: 'superadmin_1',
        action: 'legal.update',
        targetType: 'LegalDocument',
        targetId: 'refund-policy',
        metadata: expect.objectContaining({ slug: 'refund-policy', version: '2026-09-01' }),
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
