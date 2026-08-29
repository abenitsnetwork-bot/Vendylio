import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSitemapStores } from './sitemap-data';

beforeEach(() => vi.clearAllMocks());

describe('getSitemapStores', () => {
  it('scopes to published stores + ACTIVE products and selects only public fields', async () => {
    prismaMock.store.findMany.mockResolvedValue([] as never);
    await getSitemapStores();

    const arg = prismaMock.store.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ published: true });
    expect(arg?.select).toEqual({
      slug: true,
      updatedAt: true,
      products: {
        where: { status: 'ACTIVE' },
        select: { id: true, updatedAt: true },
      },
    });
    // never leak seller identity
    expect(arg?.select).not.toHaveProperty('id');
    expect(arg?.select).not.toHaveProperty('organizationId');
  });
});
