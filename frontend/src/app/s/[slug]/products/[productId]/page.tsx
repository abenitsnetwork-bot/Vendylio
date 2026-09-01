// Public product detail page — mirrors the storefront listing page's
// pattern (Server Component, direct data read via getPublicProduct, no
// /api/* round-trip) for the same SSR/link-preview reasons.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { viewerOwnsSlug } from '@/lib/server/storePreview';
import { getPublicProduct, getViaDomain, type PublicProductDetail } from '@/lib/server/storefront';
import { CartProvider } from '@/contexts/CartContext';
import { ProductDetailView } from '@/components/storefront/ProductDetailView';
import { TrackView } from '@/components/storefront/TrackView';
import { JsonLd } from '@/components/JsonLd';
import { productMetadata, productJsonLd } from '@/lib/seo';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ slug: string; productId: string }>;
}

// Same owner-preview rule as the storefront page: a draft store's product
// 404s for the public, but its owner can open it while signed in.
async function resolveProductForViewer(
  slug: string,
  productId: string,
): Promise<PublicProductDetail | null> {
  const viaDomain = await getViaDomain();
  const live = await getPublicProduct(slug, productId, { viaDomain });
  if (live) return live;
  if (viaDomain) return null;
  if (!(await viewerOwnsSlug(slug))) return null;
  return getPublicProduct(slug, productId, { includeUnpublished: true });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, productId } = await params;
  const result = await resolveProductForViewer(slug, productId);
  if (!result) return { title: 'Product not found', robots: { index: false, follow: false } };
  if (!result.store.published) {
    return {
      title: `Preview — ${result.product.name}`,
      robots: { index: false, follow: false },
    };
  }
  return productMetadata(result.store, result.product);
}

export default async function ProductDetailPage({ params }: Params) {
  const { slug, productId } = await params;
  const result = await resolveProductForViewer(slug, productId);
  if (!result) notFound();

  return (
    <CartProvider storeSlug={result.store.slug}>
      <TrackView
        slug={result.store.slug}
        kind="PRODUCT"
        productId={result.product.id}
        enabled={result.store.published}
      />
      {result.store.published && <JsonLd data={productJsonLd(result.store, result.product)} />}
      <ProductDetailView store={result.store} product={result.product} />
    </CartProvider>
  );
}
