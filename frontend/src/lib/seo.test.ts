import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  siteOrigin,
  absoluteUrl,
  metaText,
  serializeJsonLd,
  storeMetadata,
  productMetadata,
  storeJsonLd,
  productJsonLd,
} from './seo';

beforeEach(() => vi.stubEnv('APP_URL', 'https://vendylio.example'));
afterEach(() => vi.unstubAllEnvs());

const STORE = {
  slug: 'marias-bakery',
  name: "Maria's Bakery",
  description: '  Fresh baked goods\nmade locally.  ',
  city: 'Austin',
  state: 'TX',
  logoUrl: 'https://cdn.test/logo.jpg',
  phone: '+1 555-0100',
};

const PRODUCT = {
  id: 'prod-1',
  name: 'Chocolate Cake',
  description: 'Rich and fudgy.',
  priceCents: 3500,
  quantity: 4,
  imageUrl: 'https://cdn.test/cake.jpg',
  unit: 'UNIT',
};

describe('url helpers', () => {
  it('siteOrigin strips a trailing slash', () => {
    vi.stubEnv('APP_URL', 'https://vendylio.example/');
    expect(siteOrigin()).toBe('https://vendylio.example');
  });
  it('absoluteUrl joins origin + path', () => {
    expect(absoluteUrl('/s/x')).toBe('https://vendylio.example/s/x');
    expect(absoluteUrl('s/x')).toBe('https://vendylio.example/s/x');
  });
  it('metaText collapses whitespace and truncates', () => {
    expect(metaText('  a\n b  ')).toBe('a b');
    expect(metaText(null)).toBeUndefined();
    expect(metaText('')).toBeUndefined();
    expect(metaText('x'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('storeMetadata', () => {
  it('uses the merchant name as the title (no Vendylio suffix) and a canonical path', () => {
    const m = storeMetadata(STORE);
    expect(m.title).toBe("Maria's Bakery");
    expect(m.alternates?.canonical).toBe('/s/marias-bakery');
    expect(m.robots).toEqual({ index: true, follow: true });
  });
  it('builds OG + Twitter from real data with the logo as the image', () => {
    const m = storeMetadata(STORE);
    expect(m.openGraph?.url).toBe('https://vendylio.example/s/marias-bakery');
    expect(m.openGraph).toMatchObject({ type: 'website', siteName: "Maria's Bakery" });
    expect(m.openGraph?.images).toEqual([
      { url: 'https://cdn.test/logo.jpg', alt: "Maria's Bakery" },
    ]);
    expect((m.twitter as { card?: string }).card).toBe('summary_large_image');
  });
  it('falls back to a generated description and summary card when the store has no logo/description', () => {
    const m = storeMetadata({ ...STORE, description: null, logoUrl: null });
    expect(m.description).toContain("Shop Maria's Bakery in Austin, TX");
    expect(m.openGraph?.images).toBeUndefined();
    expect((m.twitter as { card?: string }).card).toBe('summary');
  });
});

describe('productMetadata', () => {
  it('title is "<product> — <store>", canonical is the product path', () => {
    const m = productMetadata(STORE, PRODUCT);
    expect(m.title).toBe("Chocolate Cake — Maria's Bakery");
    expect(m.alternates?.canonical).toBe('/s/marias-bakery/products/prod-1');
    expect(m.openGraph?.images).toEqual([
      { url: 'https://cdn.test/cake.jpg', alt: 'Chocolate Cake' },
    ]);
  });
});

describe('storeJsonLd', () => {
  it('is a LocalBusiness with address when a city/state is set', () => {
    const ld = storeJsonLd(STORE);
    expect(ld['@type']).toBe('LocalBusiness');
    expect(ld.url).toBe('https://vendylio.example/s/marias-bakery');
    expect(ld.telephone).toBe('+1 555-0100');
    expect(ld.address).toMatchObject({
      addressLocality: 'Austin',
      addressRegion: 'TX',
      addressCountry: 'US',
    });
  });
  it('is a plain Store with no address when no location is set', () => {
    const ld = storeJsonLd({ ...STORE, city: null, state: null });
    expect(ld['@type']).toBe('Store');
    expect(ld.address).toBeUndefined();
  });
});

describe('productJsonLd', () => {
  it('emits a real Offer and never a fabricated rating', () => {
    const ld = productJsonLd(STORE, PRODUCT);
    expect(ld['@type']).toBe('Product');
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld.offers).toMatchObject({
      '@type': 'Offer',
      price: '35.00',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: 'https://vendylio.example/s/marias-bakery/products/prod-1',
    });
  });
  it('marks availability OutOfStock at zero quantity', () => {
    const ld = productJsonLd(STORE, { ...PRODUCT, quantity: 0 });
    expect((ld.offers as { availability: string }).availability).toBe(
      'https://schema.org/OutOfStock',
    );
  });
});

describe('serializeJsonLd', () => {
  it('produces valid JSON that round-trips', () => {
    const out = serializeJsonLd({ '@type': 'Product', name: 'Cake' });
    expect(JSON.parse(out)).toEqual({ '@type': 'Product', name: 'Cake' });
  });

  it('neutralizes a </script> breakout and bare markup/entities in merchant text', () => {
    const out = serializeJsonLd({ name: '</script><script>alert(1)</script> Ben & Jerry' });
    expect(out).not.toMatch(/[<>&]/);
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script> Ben & Jerry');
  });
});
