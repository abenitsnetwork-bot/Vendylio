import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({
  requireAuth: vi.fn(),
}));
vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { POST, GET } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

const validBody = {
  name: 'Shea Butter 250g',
  priceCents: 1800,
  quantity: 10,
  category: 'BEAUTY_PERSONAL_CARE',
};

function makePost(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/products', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
});

describe('POST /api/products', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost(validBody, 'missing'));
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(401);
  });

  it('404s with NO_STORE when the seller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('400s on invalid category', async () => {
    const res = await POST(makePost({ ...validBody, category: 'NOT_A_CATEGORY' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('400s on non-integer priceCents', async () => {
    const res = await POST(makePost({ ...validBody, priceCents: 18.5 }));
    expect(res.status).toBe(400);
  });

  it('creates the product scoped to the caller store and returns 201', async () => {
    prismaMock.product.create.mockResolvedValue({
      id: 'prod-1',
      storeId: 'store-1',
      ...validBody,
    } as never);
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(201);
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.storeId).toBe('store-1');
    expect(createArg?.data?.name).toBe('Shea Butter 250g');
  });

  it('defaults unit to UNIT when omitted (Phase 7)', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost(validBody));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.unit).toBe('UNIT');
  });

  it('accepts an explicit weight unit (Phase 7)', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost({ ...validBody, unit: 'KG' }));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.unit).toBe('KG');
  });

  it('400s on an invalid unit', async () => {
    const res = await POST(makePost({ ...validBody, unit: 'POUNDS' }));
    expect(res.status).toBe(400);
  });

  it('accepts a fractional quantity for a weight unit (e.g. 12.09 lb)', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost({ ...validBody, unit: 'LB', quantity: 12.09 }));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.quantity).toBe(12.09);
  });

  it('rounds a fractional quantity to 2 decimal places', async () => {
    prismaMock.product.create.mockResolvedValue({ id: 'prod-1', ...validBody } as never);
    await POST(makePost({ ...validBody, unit: 'KG', quantity: 12.0949999 }));
    const createArg = prismaMock.product.create.mock.calls[0]?.[0];
    expect(createArg?.data?.quantity).toBe(12.09);
  });

  it('400s on a fractional quantity for a per-item (UNIT) product', async () => {
    const res = await POST(makePost({ ...validBody, quantity: 3.5 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/products', () => {
  function makeGet(): NextRequest {
    return new NextRequest('http://test/api/products', { method: 'GET' });
  }

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('404s with NO_STORE when the seller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeGet());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('lists products scoped to the caller store, newest first', async () => {
    prismaMock.product.findMany.mockResolvedValue([{ id: 'prod-1', storeId: 'store-1' }] as never);
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.products).toHaveLength(1);
    const args = prismaMock.product.findMany.mock.calls[0]?.[0];
    expect(args?.where).toEqual({ storeId: 'store-1' });
    expect(args?.orderBy).toEqual({ createdAt: 'desc' });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
