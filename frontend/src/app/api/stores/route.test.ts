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
vi.mock('@/lib/server/delivery/uber-direct', () => ({
  checkPickupAddressDeliverable: vi.fn(),
}));

import { requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { checkPickupAddressDeliverable } from '@/lib/server/delivery/uber-direct';
import { POST, PATCH } from './route';

const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const mockCheckPickupAddressDeliverable = vi.mocked(checkPickupAddressDeliverable);
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
  // Store creation now requires Terms acceptance — default it on for the
  // existing cases; a test that needs it absent/false sets the key itself.
  const withTerms =
    body && typeof body === 'object' && !('termsAccepted' in body)
      ? { termsAccepted: true, ...(body as Record<string, unknown>) }
      : body;
  return makeReq('POST', withTerms, csrf);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(authedCtx);
  mockCheckPickupAddressDeliverable.mockResolvedValue(null);
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
    expect(storeCreateArg?.data?.termsAcceptedAt).toBeInstanceOf(Date);
    expect(storeCreateArg?.data?.termsVersion).toBe('2026-08-27');
  });

  it('400 TERMS_NOT_ACCEPTED when the Terms checkbox was not ticked', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await POST(makeReq('POST', { name: 'Shea Store', termsAccepted: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('TERMS_NOT_ACCEPTED');
    expect(prismaMock.store.create).not.toHaveBeenCalled();
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

  it('seeds ensureUniqueSlug from a merchant-supplied slug instead of the name', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    prismaMock.organization.create.mockResolvedValue({ id: 'org-1' } as never);
    prismaMock.store.create.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'my-custom-link',
      name: "Adaeze's Shea Butter",
    } as never);

    const res = await POST(makePost({ name: "Adaeze's Shea Butter", slug: 'My Custom Link!' }));
    expect(res.status).toBe(201);

    const orgCreateArg = prismaMock.organization.create.mock.calls[0]?.[0];
    // ensureUniqueSlug's candidate is derived from slugify('My Custom Link!'),
    // not slugify(name) — confirms the custom slug wins over the name-derived one.
    expect(orgCreateArg?.data?.slug).toBe('my-custom-link');
  });

  it('still derives the slug from name when no custom slug is supplied (regression)', async () => {
    mockResolveOwnStore.mockResolvedValue(null);
    prismaMock.organization.create.mockResolvedValue({ id: 'org-1' } as never);
    prismaMock.store.create.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
      slug: 'adaeze-s-shea-butter',
      name: "Adaeze's Shea Butter",
    } as never);

    await POST(makePost({ name: "Adaeze's Shea Butter" }));
    const orgCreateArg = prismaMock.organization.create.mock.calls[0]?.[0];
    expect(orgCreateArg?.data?.slug).toBe('adaeze-s-shea-butter');
  });

  it('a second caller cannot use a custom slug to influence anything once they already have a store', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'someone-elses-store' } as never);
    const res = await POST(makePost({ name: 'New Attempt', slug: 'stolen-link' }));
    expect(res.status).toBe(409);
    expect(prismaMock.organization.create).not.toHaveBeenCalled();
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

  it('updates the Phase 8 store-ops fields (timezone, pause, hours)', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({ id: 'store-1' } as never);

    const res = await PATCH(
      makeReq('PATCH', {
        timezone: 'America/Chicago',
        ordersPaused: true,
        pauseMessage: 'Back Monday',
        hours: [{ day: 1, open: '09:00', close: '17:00' }],
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      timezone: 'America/Chicago',
      ordersPaused: true,
      pauseMessage: 'Back Monday',
      hours: [{ day: 1, open: '09:00', close: '17:00' }],
    });
  });

  it('updates the Phase 9 hero fields (images + global promo message)', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({ id: 'store-1' } as never);

    const res = await PATCH(
      makeReq('PATCH', {
        heroImages: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
        heroHeadline: 'Fresh groceries, fast',
        heroSubhead: 'Same-day pickup or delivery',
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      heroImages: ['https://cdn/a.jpg', 'https://cdn/b.jpg'],
      heroHeadline: 'Fresh groceries, fast',
      heroSubhead: 'Same-day pickup or delivery',
    });
  });

  it('updates the storefront announcement, and clears it with null', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({ id: 'store-1' } as never);

    await PATCH(makeReq('PATCH', { announcement: 'Free delivery over $30' }));
    expect(prismaMock.store.update.mock.calls[0]?.[0]?.data).toMatchObject({
      announcement: 'Free delivery over $30',
    });

    await PATCH(makeReq('PATCH', { announcement: null }));
    expect(prismaMock.store.update.mock.calls[1]?.[0]?.data).toMatchObject({ announcement: null });
  });

  it('400s on more than 3 hero images', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    const res = await PATCH(
      makeReq('PATCH', {
        heroImages: [
          'https://cdn/a.jpg',
          'https://cdn/b.jpg',
          'https://cdn/c.jpg',
          'https://cdn/d.jpg',
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('400s on a non-URL hero image', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    const res = await PATCH(makeReq('PATCH', { heroImages: ['not-a-url'] }));
    expect(res.status).toBe(400);
  });

  it('400s on an unknown timezone', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    const res = await PATCH(makeReq('PATCH', { timezone: 'Not/AZone' }));
    expect(res.status).toBe(400);
  });

  it('400s when an hours row closes before it opens', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    const res = await PATCH(
      makeReq('PATCH', { hours: [{ day: 1, open: '17:00', close: '09:00' }] }),
    );
    expect(res.status).toBe(400);
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

  it('surfaces deliverabilityWarning when checkPickupAddressDeliverable says no', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({
      id: 'store-1',
      deliveryProvider: 'uber_direct',
      pickupAddress: '5329 w ian dr, laveen, az, 85339',
    } as never);
    mockCheckPickupAddressDeliverable.mockResolvedValueOnce(false);

    const res = await PATCH(
      makeReq('PATCH', {
        deliveryProvider: 'uber_direct',
        pickupAddress: '5329 w ian dr, laveen, az, 85339',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliverabilityWarning).toMatch(/does not currently service/);
    expect(mockCheckPickupAddressDeliverable).toHaveBeenCalledWith(
      '5329 w ian dr, laveen, az, 85339',
    );
  });

  it('omits deliverabilityWarning when the check is inconclusive (null)', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({
      id: 'store-1',
      deliveryProvider: 'uber_direct',
      pickupAddress: '100 W Washington St, Phoenix, AZ 85003',
    } as never);
    mockCheckPickupAddressDeliverable.mockResolvedValueOnce(null);

    const res = await PATCH(
      makeReq('PATCH', {
        deliveryProvider: 'uber_direct',
        pickupAddress: '100 W Washington St, Phoenix, AZ 85003',
      }),
    );
    const body = await res.json();
    expect(body.deliverabilityWarning).toBeUndefined();
  });

  it('skips the deliverability check entirely when the save does not touch pickupAddress/deliveryProvider', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({
      id: 'store-1',
      deliveryProvider: 'uber_direct',
      pickupAddress: '5329 w ian dr, laveen, az, 85339',
    } as never);

    await PATCH(makeReq('PATCH', { deliveryFeeCents: 500 }));
    expect(mockCheckPickupAddressDeliverable).not.toHaveBeenCalled();
  });

  it('skips the deliverability check for self_manual stores', async () => {
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1', organizationId: 'org-1' } as never);
    prismaMock.store.update.mockResolvedValue({
      id: 'store-1',
      deliveryProvider: 'self_manual',
      pickupAddress: '5329 w ian dr, laveen, az, 85339',
    } as never);

    await PATCH(makeReq('PATCH', { pickupAddress: '5329 w ian dr, laveen, az, 85339' }));
    expect(mockCheckPickupAddressDeliverable).not.toHaveBeenCalled();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
