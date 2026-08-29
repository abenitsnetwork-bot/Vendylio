import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/org', () => ({ resolveOwnStore: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { POST } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'seller@example.com' } };

function makeReq(body?: unknown, csrf: 'match' | 'missing' = 'match') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/testimonials', {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
  prismaMock.user.findUnique.mockResolvedValue({
    name: 'Adaeze O.',
    email: 'seller@example.com',
  } as never);
  prismaMock.store.findUnique.mockResolvedValue({
    name: "Adaeze's Shea Butter",
    city: 'Baltimore',
    state: 'MD',
  } as never);
  prismaMock.testimonial.findFirst.mockResolvedValue(null);
});

describe('POST /api/testimonials', () => {
  it('403s without the CSRF header', async () => {
    expect((await POST(makeReq({ quote: 'x'.repeat(20) }, 'missing'))).status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(NextResponse.json({ error: 'x' }, { status: 401 }));
    expect((await POST(makeReq({ quote: 'x'.repeat(20) }))).status).toBe(401);
  });

  it('404s NO_STORE when the seller has no store', async () => {
    mockResolveOwnStore.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ quote: 'x'.repeat(20) }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('NO_STORE');
  });

  it('400s on a too-short quote', async () => {
    expect((await POST(makeReq({ quote: 'nice' }))).status).toBe(400);
  });

  it('creates a hidden draft with the seller identity denormalised', async () => {
    prismaMock.testimonial.create.mockResolvedValue({ id: 't1' } as never);

    const res = await POST(makeReq({ quote: 'Vendylio changed how I run my shop.', rating: 5 }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, status: 'PENDING_REVIEW' });

    expect(prismaMock.testimonial.create.mock.calls[0]?.[0]?.data).toMatchObject({
      name: 'Adaeze O.',
      location: 'Baltimore, MD',
      detail: "Adaeze's Shea Butter",
      quote: 'Vendylio changed how I run my shop.',
      rating: 5,
      visible: false,
    });
  });

  it('429s when a testimonial for this store was submitted in the last 24h', async () => {
    prismaMock.testimonial.findFirst.mockResolvedValueOnce({ id: 'recent' } as never);
    const res = await POST(makeReq({ quote: 'x'.repeat(20) }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('TESTIMONIAL_ALREADY_SUBMITTED');
    expect(prismaMock.testimonial.create).not.toHaveBeenCalled();
  });

  it('falls back to the email local-part when the user has no name', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      name: null,
      email: 'seller@example.com',
    } as never);
    prismaMock.testimonial.create.mockResolvedValue({ id: 't1' } as never);

    await POST(makeReq({ quote: 'x'.repeat(20) }));
    expect(prismaMock.testimonial.create.mock.calls[0]?.[0]?.data).toMatchObject({
      name: 'seller',
      rating: null,
    });
  });
});
