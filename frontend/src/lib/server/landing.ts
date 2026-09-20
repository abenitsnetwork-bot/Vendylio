import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { SITE_IMAGE_KEYS, type SiteImageKey } from '@/lib/siteImageKeys';
import { SITE_VIDEO_KEYS, type SiteVideoKey } from '@/lib/siteVideoKeys';

export interface LandingImage {
  url: string;
  altText: string | null;
}

export interface LandingVideo {
  url: string;
  posterUrl: string | null;
}

export interface LandingTestimonial {
  id: string;
  name: string;
  location: string | null;
  detail: string | null;
  quote: string;
  avatarUrl: string | null;
  rating: number | null;
}

export interface LandingPageContent {
  /** Keyed by SiteImageKey; a missing key means no image has been uploaded
   * yet — callers fall back to their own placeholder. */
  images: Partial<Record<SiteImageKey, LandingImage>>;
  testimonials: LandingTestimonial[];
  /** Live count of published stores — drives the social-proof element via
   * `sellerProof()` (hidden entirely below MIN_SELLERS_FOR_PROOF). */
  sellerCount: number;
  /** Keyed by SiteVideoKey (SITE_VIDEO_KEYS manifest); a missing key means
   * no video has been uploaded to that slot yet — callers fall back to a
   * still image or a bundled default. */
  videos: Partial<Record<SiteVideoKey, LandingVideo>>;
}

/** Public, unauthenticated: number of published storefronts. */
export function getPublishedSellerCount(): Promise<number> {
  return prisma.store.count({ where: { published: true } });
}

/**
 * Public landing-page read — no auth. Only `visible` testimonials are
 * returned, ordered by the admin's chosen sortOrder (ties broken by
 * newest first). Missing image slots are simply absent from the map rather
 * than resolved to a default — the marketing components own their own
 * placeholder fallback.
 */
export async function getLandingPageContent(): Promise<LandingPageContent> {
  const knownImageKeys = SITE_IMAGE_KEYS.map((k) => k.key);
  const knownVideoKeys = SITE_VIDEO_KEYS.map((k) => k.key);

  const [imageRows, testimonialRows, sellerCount, videoRows] = await Promise.all([
    prisma.siteImage.findMany({
      where: { key: { in: knownImageKeys } },
      select: { key: true, url: true, altText: true },
    }),
    prisma.testimonial.findMany({
      where: { visible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        location: true,
        detail: true,
        quote: true,
        avatarUrl: true,
        rating: true,
      },
    }),
    getPublishedSellerCount(),
    prisma.siteVideo.findMany({
      where: { key: { in: knownVideoKeys } },
      select: { key: true, url: true, posterUrl: true },
    }),
  ]);

  const images: Partial<Record<SiteImageKey, LandingImage>> = {};
  for (const row of imageRows) {
    images[row.key as SiteImageKey] = { url: row.url, altText: row.altText };
  }

  const videos: Partial<Record<SiteVideoKey, LandingVideo>> = {};
  for (const row of videoRows) {
    videos[row.key as SiteVideoKey] = { url: row.url, posterUrl: row.posterUrl };
  }

  return { images, testimonials: testimonialRows, sellerCount, videos };
}
