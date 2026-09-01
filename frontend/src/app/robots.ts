import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/seo';

// Public storefronts + marketing pages are crawlable; everything behind auth
// or under the API is not. Draft stores are already excluded structurally —
// they 404 for anyone (published:false) so there's no URL to disallow.
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/dashboard/',
        '/admin/',
        '/onboarding/',
        '/settings/',
        '/verify-email/',
        '/forgot-password',
        '/reset-password',
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
