import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const getSitemapStores = vi.fn();
vi.mock('@/lib/server/sitemap-data', () => ({ getSitemapStores: () => getSitemapStores() }));

beforeEach(() => {
  vi.stubEnv('APP_URL', 'https://vendylio.example');
  getSitemapStores.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('sitemap()', () => {
  it('lists the static marketing pages plus every published store and its active products', async () => {
    getSitemapStores.mockResolvedValueOnce([
      {
        slug: 'marias-bakery',
        updatedAt: new Date('2026-08-01T00:00:00Z'),
        products: [{ id: 'p1', updatedAt: new Date('2026-08-02T00:00:00Z') }],
      },
    ]);
    const { default: sitemap } = await import('./sitemap');
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls).toContain('https://vendylio.example/');
    expect(urls).toContain('https://vendylio.example/how-it-works');
    expect(urls).toContain('https://vendylio.example/pricing');
    expect(urls).toContain('https://vendylio.example/s/marias-bakery');
    expect(urls).toContain('https://vendylio.example/s/marias-bakery/products/p1');

    const productEntry = entries.find((e) => e.url.endsWith('/products/p1'));
    expect(productEntry?.lastModified).toEqual(new Date('2026-08-02T00:00:00Z'));
  });

  it('degrades to just the static pages if the store query throws', async () => {
    getSitemapStores.mockRejectedValueOnce(new Error('db down'));
    const { default: sitemap } = await import('./sitemap');
    const entries = await sitemap();
    expect(entries.every((e) => !e.url.includes('/s/'))).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it('never lists dashboard/admin/api paths', async () => {
    getSitemapStores.mockResolvedValueOnce([]);
    const { default: sitemap } = await import('./sitemap');
    const urls = (await sitemap()).map((e) => e.url).join(' ');
    expect(urls).not.toMatch(/\/dashboard|\/admin|\/api\//);
  });
});
