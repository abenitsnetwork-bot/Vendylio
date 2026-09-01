import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/seo';
import { getSitemapStores } from '@/lib/server/sitemap-data';

export const runtime = 'nodejs';
// Rebuilt hourly rather than per-request — the store/product set changes
// slowly and crawlers don't need second-fresh data.
export const revalidate = 3600;

const STATIC_PATHS = [
  '/',
  '/how-it-works',
  '/pricing',
  '/register',
  '/privacy',
  '/terms',
  '/refund-policy',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${origin}${path}`,
    lastModified: now,
    changeFrequency: 'monthly',
    priority: path === '/' ? 1 : 0.5,
  }));

  let storeEntries: MetadataRoute.Sitemap = [];
  try {
    const stores = await getSitemapStores();
    storeEntries = stores.flatMap((store) => [
      {
        url: `${origin}/s/${store.slug}`,
        lastModified: store.updatedAt,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      },
      ...store.products.map((product) => ({
        url: `${origin}/s/${store.slug}/products/${product.id}`,
        lastModified: product.updatedAt,
        changeFrequency: 'weekly' as const,
        priority: 0.7,
      })),
    ]);
  } catch {
    // A DB hiccup must not 500 the sitemap — serve the static entries and
    // let the next revalidation pick up the stores.
  }

  return [...staticEntries, ...storeEntries];
}
