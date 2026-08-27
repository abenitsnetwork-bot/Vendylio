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
import { POST, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const authedCtx = { user: { sub: 'user-1', email: 'me@example.com' } };

function makeReq(
  method: 'POST' | 'PATCH',
  body: unknown,
  csrf: 'match' | 'missing' = 'match',
): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'csrf-tok';
    headers['cookie'] = 'app-csrf=csrf-tok';
  }
  return new NextRequest('http://test/api/stores', {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

function makePost(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  return makeReq('POST', body, csrf);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  // Default $transaction passes the prismaMock as `tx` so writes within the
  // callback hit the same mocks as the outer client (mockDeep proxies them).
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
});

describe('POST /api/stores', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost({ name: 'Shea Store' }, 'missing'));
    expect(res.status).toBe(403);
    expect(mockResolveOwnStore).not.toHaveBeenCalled();
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await POST(makePost({ name: 'Shea Store' }));
    expect(res.status).toBe(401);
  });

  it('400s on invalid body', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await POST(makePost({ name: 'a' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('409s when the user already has a store', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    const res = await POST(makePost({ name: 'Shea Store' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('STORE_ALREADY_EXISTS');
  });

  it('creates an Organization + OrganizationMember{OWNER} + Store, slugified, and returns 201', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    prismaMock.organization.create.mockResolvedValue({
      id: 'org-1',
      slug: 'adaeze-s-shea-butter',
      name: "Adaeze's Shea Butter",
      ownerId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    prismaMock.store.create.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'adaeze-s-shea-butter',
      name: "Adaeze's Shea Butter",
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await POST(makePost({ name: "Adaeze's Shea Butter" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.store.slug).toBe('adaeze-s-shea-butter');

    const orgCreateArg = prismaMock.organization.create.mock.calls[0]?.[0];
    expect(orgCreateArg?.data?.ownerId).toBe('user-1');
    expect(orgCreateArg?.data?.slug).toBe('adaeze-s-shea-butter');

    const memberCreateArg = prismaMock.organizationMember.create.mock.calls[0]?.[0];
    expect(memberCreateArg?.data).toEqual({
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'OWNER',
    });

    const storeCreateArg = prismaMock.store.create.mock.calls[0]?.[0];
    expect(storeCreateArg?.data?.organizationId).toBe('org-1');
  });

  it('passes phone through to Store.create when provided', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    prismaMock.organization.create.mockResolvedValue({
      id: 'org-1',
      slug: 'adaeze-s-shea-butter',
      name: "Adaeze's Shea Butter",
      ownerId: 'user-1',
    } as never);
    prismaMock.store.create.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'adaeze-s-shea-butter',
      name: "Adaeze's Shea Butter",
      phone: '+1 555-0100',
    } as never);

    await POST(makePost({ name: "Adaeze's Shea Butter", phone: '+1 555-0100' }));
    const storeCreateArg = prismaMock.store.create.mock.calls[0]?.[0];
    expect(storeCreateArg?.data?.phone).toBe('+1 555-0100');
  });
});

describe('PATCH /api/stores', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await PATCH(makeReq('PATCH', { name: 'New Name' }, 'missing'));
    expect(res.status).toBe(403);
  });

  it('401s when requireAuth bails', async () => {
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await PATCH(makeReq('PATCH', { name: 'New Name' }));
    expect(res.status).toBe(401);
  });

  it('404s with NO_STORE when the caller has no store yet', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await PATCH(makeReq('PATCH', { name: 'New Name' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('400s on invalid body', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    const res = await PATCH(makeReq('PATCH', { name: 'a' }));
    expect(res.status).toBe(400);
  });

  it('updates fields without touching the slug', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'adaezes-shea-butter',
      name: 'Adaeze Boutique',
      description: 'Updated description',
      city: 'Baltimore',
      state: 'Maryland',
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(
      makeReq('PATCH', { name: 'Adaeze Boutique', description: 'Updated description' }),
    );
    expect(res.status).toBe(200);
    const updateArg = prismaMock.store.update.mock.calls[0]?.[0];
    expect(updateArg?.where).toEqual({ id: 'store-1' });
    expect(updateArg?.data).not.toHaveProperty('slug');
  });

  it('updates deliveryFeeCents (Phase 5)', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({ id: 'store-1', deliveryFeeCents: 500 } as never);

    const res = await PATCH(makeReq('PATCH', { deliveryFeeCents: 500 }));
    expect(res.status).toBe(200);
    const updateArg = prismaMock.store.update.mock.calls[0]?.[0];
    expect(updateArg?.data).toMatchObject({ deliveryFeeCents: 500 });
  });

  it('updates phone, and clears it with an explicit null', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValueOnce({ id: 'store-1', phone: '+1 555-0100' } as never);

    await PATCH(makeReq('PATCH', { phone: '+1 555-0100' }));
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      phone: '+1 555-0100',
    });

    prismaMock.store.update.mockResolvedValueOnce({ id: 'store-1', phone: null } as never);
    await PATCH(makeReq('PATCH', { phone: null }));
    expect(prismaMock.store.update.mock.calls[1]?.[0]?.data).toMatchObject({ phone: null });
  });

  it('strips a leading "$" from cashAppCashtag', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValueOnce({
      id: 'store-1',
      cashAppCashtag: 'AdaezeShop',
    } as never);

    await PATCH(makeReq('PATCH', { cashAppCashtag: '$AdaezeShop' }));
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      cashAppCashtag: 'AdaezeShop',
    });
  });

  it('updates zelleContact', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValueOnce({
      id: 'store-1',
      zelleContact: 'adaeze@example.com',
    } as never);

    await PATCH(makeReq('PATCH', { zelleContact: 'adaeze@example.com' }));
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      zelleContact: 'adaeze@example.com',
    });
  });

  it('400s on a negative deliveryFeeCents', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    const res = await PATCH(makeReq('PATCH', { deliveryFeeCents: -100 }));
    expect(res.status).toBe(400);
  });

  it('updates deliveryProvider and pickupAddress together', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({
      id: 'store-1',
      deliveryProvider: 'uber_direct',
      pickupAddress: '1 Pickup Ave, Springfield, IL 62704',
    } as never);

    const res = await PATCH(
      makeReq('PATCH', {
        deliveryProvider: 'uber_direct',
        pickupAddress: '1 Pickup Ave, Springfield, IL 62704',
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      deliveryProvider: 'uber_direct',
      pickupAddress: '1 Pickup Ave, Springfield, IL 62704',
    });
  });

  it('clears pickupAddress with an explicit null', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({ id: 'store-1', pickupAddress: null } as never);

    await PATCH(makeReq('PATCH', { pickupAddress: null }));
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      pickupAddress: null,
    });
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
