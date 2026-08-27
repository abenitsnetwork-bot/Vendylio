// Public product detail page — mirrors the storefront listing page's
// pattern (Server Component, direct data read via getPublicProduct, no
// /api/* round-trip) for the same SSR/link-preview reasons.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicProduct } from '@/lib/server/storefront';
import { CartProvider } from '@/contexts/CartContext';
import { ProductDetailView } from '@/components/storefront/ProductDetailView';

export const runtime = 'nodejs';

interface Params {
  params: Promise<{ slug: string; productId: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, productId } = await params;
  const result = await getPublicProduct(slug, productId);
  if (!result) return { title: 'Product not found — Vendylio' };
  return {
    title: `${result.product.name} — ${result.store.name}`,
    description: result.product.description ?? `${result.product.name} on Vendylio.`,
  };
}

export default async function ProductDetailPage({ params }: Params) {
  const { slug, productId } = await params;
  const result = await getPublicProduct(slug, productId);
  if (!result) notFound();

  return (
    <CartProvider storeSlug={result.store.slug}>
      <ProductDetailView store={result.store} product={result.product} />
    </CartProvider>
  );
}
