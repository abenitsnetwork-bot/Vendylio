import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

function ctxWith(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

function makeReq(): NextRequest {
  return new NextRequest('http://test/api/legal/terms');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/legal/[slug]', () => {
  it('404s on an unknown slug', async () => {
    const res = await GET(makeReq(), ctxWith('nope'));
    expect(res.status).toBe(404);
  });

  it('serves the bundled default when no row exists', async () => {
    prismaMock.legalDocument.findUnique.mockResolvedValueOnce(null);
    const res = await GET(makeReq(), ctxWith('terms'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe('terms');
    expect(body.title).toBe('Terms of Service');
    expect(body.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.body).toContain('## 1. What Vendylio is');
    // the endpoint never leaks the internal isDefault flag
    expect(body).not.toHaveProperty('isDefault');
  });

  it('serves the edited row when one exists', async () => {
    prismaMock.legalDocument.findUnique.mockResolvedValueOnce({
      slug: 'refund-policy',
      body: '## Edited\n\nBody.',
      version: '2099-12-31',
      updatedAt: new Date('2099-12-31T00:00:00Z'),
      updatedBy: null,
    } as never);
    const res = await GET(makeReq(), ctxWith('refund-policy'));
    const body = await res.json();
    expect(body.body).toBe('## Edited\n\nBody.');
    expect(body.version).toBe('2099-12-31');
  });
});
