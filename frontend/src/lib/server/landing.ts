import 'server-only';
import { prisma } from '@/lib/server/prisma';
import { SITE_IMAGE_KEYS, type SiteImageKey } from '@/lib/siteImageKeys';

export interface LandingImage {
  url: string;
  altText: string | null;
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
}

/**
 * Public landing-page read — no auth. Only `visible` testimonials are
 * returned, ordered by the admin's chosen sortOrder (ties broken by
 * newest first). Missing image slots are simply absent from the map rather
 * than resolved to a default — the marketing components own their own
 * placeholder fallback.
 */
export async function getLandingPageContent(): Promise<LandingPageContent> {
  const knownKeys = SITE_IMAGE_KEYS.map((k) => k.key);

  const [imageRows, testimonialRows] = await Promise.all([
    prisma.siteImage.findMany({
      where: { key: { in: knownKeys } },
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
  ]);

  const images: Partial<Record<SiteImageKey, LandingImage>> = {};
  for (const row of imageRows) {
    images[row.key as SiteImageKey] = { url: row.url, altText: row.altText };
  }

  return { images, testimonials: testimonialRows };
}
