// Storefront SEO helpers — pure, no DB, no React. Builds the Metadata
// objects for the public store + product pages and the JSON-LD documents
// for structured data. All values come from real merchant data; nothing is
// fabricated (no ratings/counts we don't have).
import type { Metadata } from 'next';

/** Public origin. `APP_URL` is the existing env (email links, OAuth base). */
export function siteOrigin(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function absoluteUrl(path: string): string {
  return `${siteOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Serialize a JSON-LD object for embedding in a `<script type="application/ld+json">`.
 *
 * Security: merchant-controlled strings (store/product name + description)
 * flow through here. `JSON.stringify` already escapes quotes/backslashes; we
 * additionally escape `<`, `>` and `&` to `\uXXXX` so a value containing
 * `</script>` (or an HTML entity) can never break out of the script element
 * or be parsed as markup. The result is still valid JSON and round-trips to
 * the original values. No raw HTML is ever produced.
 */
export function serializeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** Collapse whitespace and cap length for meta descriptions / OG text. */
export function metaText(input: string | null | undefined, max = 160): string | undefined {
  if (!input) return undefined;
  const clean = input.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

interface StoreSeoInput {
  slug: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  logoUrl: string | null;
}

interface ProductSeoInput {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  quantity: number;
  imageUrl: string | null;
  unit: string;
}

/** `<title>` and description for the storefront landing page. */
export function storeMetadata(store: StoreSeoInput): Metadata {
  const path = `/s/${store.slug}`;
  const location = [store.city, store.state].filter(Boolean).join(', ');
  const description =
    metaText(store.description) ??
    `Shop ${store.name}${location ? ` in ${location}` : ''} — order online for local delivery or pickup.`;
  const images = store.logoUrl ? [{ url: store.logoUrl, alt: store.name }] : undefined;

  return {
    title: store.name,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      url: absoluteUrl(path),
      siteName: store.name,
      title: store.name,
      description,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: store.name,
      description,
      ...(images ? { images: [images[0]!.url] } : {}),
    },
  };
}

/** `<title>` and description for a product detail page. */
export function productMetadata(
  store: { slug: string; name: string },
  product: ProductSeoInput,
): Metadata {
  const path = `/s/${store.slug}/products/${product.id}`;
  const description =
    metaText(product.description) ?? `${product.name} from ${store.name}. Order online.`;
  const images = product.imageUrl ? [{ url: product.imageUrl, alt: product.name }] : undefined;

  return {
    title: `${product.name} — ${store.name}`,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      url: absoluteUrl(path),
      siteName: store.name,
      title: product.name,
      description,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: `${product.name} — ${store.name}`,
      description,
      ...(images ? { images: [images[0]!.url] } : {}),
    },
  };
}

/**
 * Schema.org JSON-LD for the storefront. `LocalBusiness` when a city is
 * known (helps local search); plain `Store` otherwise. Only fields backed
 * by real data are emitted.
 */
export function storeJsonLd(
  store: StoreSeoInput & { phone: string | null },
): Record<string, unknown> {
  const path = `/s/${store.slug}`;
  const hasLocation = Boolean(store.city || store.state);
  return {
    '@context': 'https://schema.org',
    '@type': hasLocation ? 'LocalBusiness' : 'Store',
    name: store.name,
    url: absoluteUrl(path),
    ...(store.description ? { description: metaText(store.description, 300) } : {}),
    ...(store.logoUrl ? { logo: store.logoUrl, image: store.logoUrl } : {}),
    ...(store.phone ? { telephone: store.phone } : {}),
    ...(hasLocation
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(store.city ? { addressLocality: store.city } : {}),
            ...(store.state ? { addressRegion: store.state } : {}),
            addressCountry: 'US',
          },
        }
      : {}),
  };
}

/**
 * Schema.org `Product` JSON-LD with a real `Offer` (price, currency,
 * availability, URL). No `aggregateRating` — Vendylio has store-level
 * reviews but not per-product ones, so claiming a product rating would be
 * fabricated.
 */
export function productJsonLd(
  store: { slug: string; name: string },
  product: ProductSeoInput,
): Record<string, unknown> {
  const path = `/s/${store.slug}/products/${product.id}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    ...(product.description ? { description: metaText(product.description, 300) } : {}),
    ...(product.imageUrl ? { image: product.imageUrl } : {}),
    ...(product.unit === 'UNIT'
      ? {}
      : { additionalProperty: { '@type': 'PropertyValue', name: 'unit', value: product.unit } }),
    offers: {
      '@type': 'Offer',
      price: (product.priceCents / 100).toFixed(2),
      priceCurrency: 'USD',
      availability:
        product.quantity > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: absoluteUrl(path),
      seller: { '@type': 'Organization', name: store.name },
    },
  };
}
