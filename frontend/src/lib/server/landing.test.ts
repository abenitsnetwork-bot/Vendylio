import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getLandingPageContent, getPublishedSellerCount } from './landing';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.siteImage.findMany.mockResolvedValue([]);
  prismaMock.testimonial.findMany.mockResolvedValue([]);
  prismaMock.store.count.mockResolvedValue(0);
  prismaMock.siteVideo.findUnique.mockResolvedValue(null);
});

describe('getLandingPageContent', () => {
  it('returns an empty images map, no video, and empty testimonials when nothing is set', async () => {
    const result = await getLandingPageContent();
    expect(result).toEqual({ images: {}, testimonials: [], sellerCount: 0, video: null });
  });

  it('returns the video when a SiteVideo row exists for the landing key', async () => {
    prismaMock.siteVideo.findUnique.mockResolvedValueOnce({
      url: 'https://cdn/video.mp4',
      posterUrl: 'https://cdn/poster.jpg',
    } as never);

    const result = await getLandingPageContent();
    expect(result.video).toEqual({
      url: 'https://cdn/video.mp4',
      posterUrl: 'https://cdn/poster.jpg',
    });
    expect(prismaMock.siteVideo.findUnique).toHaveBeenCalledWith({
      where: { key: 'landing_hero_video' },
      select: { url: true, posterUrl: true },
    });
  });

  it('includes a live published-store count', async () => {
    prismaMock.store.count.mockResolvedValueOnce(1234 as never);
    const result = await getLandingPageContent();
    expect(result.sellerCount).toBe(1234);
    expect(prismaMock.store.count).toHaveBeenCalledWith({ where: { published: true } });
  });

  it('keys the images map by SiteImage.key', async () => {
    prismaMock.siteImage.findMany.mockResolvedValueOnce([
      { key: 'hero_showcase', url: 'https://cdn/hero.jpg', altText: 'Sellers using Vendylio' },
    ] as never);

    const result = await getLandingPageContent();
    expect(result.images).toEqual({
      hero_showcase: { url: 'https://cdn/hero.jpg', altText: 'Sellers using Vendylio' },
    });
  });

  it('scopes the testimonials query to visible=true, ordered by sortOrder then newest first', async () => {
    await getLandingPageContent();
    const arg = prismaMock.testimonial.findMany.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ visible: true });
    expect(arg?.orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'desc' }]);
  });

  it('passes testimonial rows through unchanged (shape match)', async () => {
    prismaMock.testimonial.findMany.mockResolvedValueOnce([
      {
        id: 't1',
        name: 'Adaeze O.',
        location: 'Maryland',
        detail: 'Shea butter & natural cosmetics',
        quote: 'Before Vendylio I was losing orders every day.',
        avatarUrl: null,
        rating: 5,
      },
    ] as never);

    const result = await getLandingPageContent();
    expect(result.testimonials).toEqual([
      {
        id: 't1',
        name: 'Adaeze O.',
        location: 'Maryland',
        detail: 'Shea butter & natural cosmetics',
        quote: 'Before Vendylio I was losing orders every day.',
        avatarUrl: null,
        rating: 5,
      },
    ]);
  });
});

describe('getPublishedSellerCount', () => {
  it('counts only published stores', async () => {
    prismaMock.store.count.mockResolvedValueOnce(42 as never);
    await expect(getPublishedSellerCount()).resolves.toBe(42);
    expect(prismaMock.store.count).toHaveBeenCalledWith({ where: { published: true } });
  });
});
