import 'server-only';
import { prisma } from '@/lib/server/prisma';

export interface SitemapStore {
  slug: string;
  updatedAt: Date;
  products: { id: string; updatedAt: Date }[];
}

/**
 * Every published store + its ACTIVE products, for app/sitemap.ts. Mirrors
 * the storefront's own visibility rules (published stores, ACTIVE products)
 * so the sitemap never lists a URL that would 404 or noindex. One query,
 * public fields only.
 */
export async function getSitemapStores(): Promise<SitemapStore[]> {
  return prisma.store.findMany({
    where: { published: true },
    select: {
      slug: true,
      updatedAt: true,
      products: {
        where: { status: 'ACTIVE' },
        select: { id: true, updatedAt: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
}
