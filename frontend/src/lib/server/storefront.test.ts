import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPublicStore, getPublicProduct } from './storefront';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPublicStore', () => {
  it('returns null when no store matches the slug', async () => {
    prismaMock.store.findFirst.mockResolvedValue(null);
    const result = await getPublicStore('nope');
    expect(result).toBeNull();
  });

  it('scopes products to status=ACTIVE and orders newest first', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      products: [],
      reviews: [],
    } as never);

    await getPublicStore('shea-store');

    const arg = prismaMock.store.findFirst.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ slug: 'shea-store', published: true });
    expect(arg?.select?.products).toMatchObject({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('selects unit and variants on each product (Phase 7)', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      products: [],
      reviews: [],
    } as never);

    await getPublicStore('shea-store');

    const arg = prismaMock.store.findFirst.mock.calls[0]?.[0];
    expect(arg?.select?.products).toMatchObject({
      select: {
        unit: true,
        variants: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, value: true, priceDeltaCents: true, quantity: true },
        },
      },
    });
  });

  it('selects only visible reviews, newest first (Phase 8)', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      products: [],
      reviews: [],
    } as never);

    await getPublicStore('shea-store');

    const arg = prismaMock.store.findFirst.mock.calls[0]?.[0];
    expect(arg?.select?.reviews).toMatchObject({
      where: { visible: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('computes averageRating/reviewCount and flattens the customer name (Phase 8)', async () => {
    const createdAt = new Date('2026-08-01T00:00:00Z');
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      products: [],
      reviews: [
        { id: 'r1', rating: 5, text: 'Great!', createdAt, order: { customerName: 'Amara' } },
        { id: 'r2', rating: 3, text: null, createdAt, order: { customerName: null } },
      ],
    } as never);

    const result = await getPublicStore('shea-store');

    expect(result?.reviewCount).toBe(2);
    expect(result?.averageRating).toBe(4);
    expect(result?.reviews).toEqual([
      { id: 'r1', rating: 5, text: 'Great!', customerName: 'Amara', createdAt },
      { id: 'r2', rating: 3, text: null, customerName: null, createdAt },
    ]);
  });

  it('returns averageRating=null and reviewCount=0 when there are no visible reviews', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      description: null,
      city: null,
      state: null,
      logoUrl: null,
      products: [],
      reviews: [],
    } as never);

    const result = await getPublicStore('shea-store');

    expect(result?.averageRating).toBeNull();
    expect(result?.reviewCount).toBe(0);
  });

  it('only returns published stores — unpublished ones read as not-found', async () => {
    prismaMock.store.findFirst.mockResolvedValue(null);
    const result = await getPublicStore('unpublished-store');
    expect(result).toBeNull();
    const arg = prismaMock.store.findFirst.mock.calls[0]?.[0];
    expect(arg?.where).toMatchObject({ published: true });
  });

  it('never selects organizationId or id on the store (public read, no seller identity leak)', async () => {
    prismaMock.store.findFirst.mockResolvedValue(null);
    await getPublicStore('shea-store');
    const arg = prismaMock.store.findFirst.mock.calls[0]?.[0];
    expect(arg?.select).not.toHaveProperty('id');
    expect(arg?.select).not.toHaveProperty('organizationId');
  });

  it('selects phone (shown in the storefront top bar)', async () => {
    prismaMock.store.findFirst.mockResolvedValue(null);
    await getPublicStore('shea-store');
    const arg = prismaMock.store.findFirst.mock.calls[0]?.[0];
    expect(arg?.select).toMatchObject({ phone: true });
  });
});

describe('getPublicProduct', () => {
  it('returns null when no store matches the slug', async () => {
    prismaMock.store.findFirst.mockResolvedValue(null);
    const result = await getPublicProduct('nope', 'p1');
    expect(result).toBeNull();
  });

  it('returns null when the product is not in this store (or is ARCHIVED)', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      logoUrl: null,
      phone: null,
      template: 'MODERN',
      products: [],
    } as never);
    const result = await getPublicProduct('shea-store', 'not-in-this-store');
    expect(result).toBeNull();
  });

  it('scopes the product lookup to this store + id + status=ACTIVE', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      logoUrl: null,
      phone: null,
      template: 'MODERN',
      products: [],
    } as never);
    await getPublicProduct('shea-store', 'p1');
    const arg = prismaMock.store.findFirst.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ slug: 'shea-store', published: true });
    expect(arg?.select?.products).toMatchObject({ where: { id: 'p1', status: 'ACTIVE' } });
  });

  it('returns the flattened store header + product on a match', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      logoUrl: 'https://cdn/logo.jpg',
      phone: '+1 555-0100',
      template: 'BOLD',
      products: [
        {
          id: 'p1',
          name: 'Shea Butter',
          description: null,
          priceCents: 1800,
          quantity: 5,
          category: 'BEAUTY_PERSONAL_CARE',
          unit: 'UNIT',
          imageUrl: null,
          variants: [],
        },
      ],
    } as never);

    const result = await getPublicProduct('shea-store', 'p1');
    expect(result).toEqual({
      store: {
        slug: 'shea-store',
        name: 'Shea Store',
        logoUrl: 'https://cdn/logo.jpg',
        phone: '+1 555-0100',
        template: 'BOLD',
      },
      product: {
        id: 'p1',
        name: 'Shea Butter',
        description: null,
        priceCents: 1800,
        quantity: 5,
        category: 'BEAUTY_PERSONAL_CARE',
        unit: 'UNIT',
        imageUrl: null,
        variants: [],
      },
    });
  });

  it('falls back to MODERN when the stored template value is unrecognized', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      slug: 'shea-store',
      name: 'Shea Store',
      logoUrl: null,
      phone: null,
      template: 'SOMETHING_BOGUS',
      products: [
        {
          id: 'p1',
          name: 'Shea Butter',
          description: null,
          priceCents: 1800,
          quantity: 5,
          category: 'BEAUTY_PERSONAL_CARE',
          unit: 'UNIT',
          imageUrl: null,
          variants: [],
        },
      ],
    } as never);

    const result = await getPublicProduct('shea-store', 'p1');
    expect(result?.store.template).toBe('MODERN');
  });
});
