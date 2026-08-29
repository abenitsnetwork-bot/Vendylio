// Single source of truth for the seller Resources centre
// (/dashboard/resources). Every entry is a REAL guide page that exists under
// src/app/dashboard/(shell)/resources/<slug>/ — there are no "coming soon"
// rows, no downloadable PDFs we don't have, and no fabricated success
// stories. Add a row here only once its page is written.

export type ResourceCategory = 'Getting Started' | 'Marketing & Growth' | 'Operations & Money';

export interface ResourceGuide {
  slug: string;
  title: string;
  /** Human read-time, e.g. "8 min". */
  time: string;
  category: ResourceCategory;
  /** One line shown under the title in the category card. */
  blurb: string;
}

export const RESOURCE_CATEGORIES: {
  key: ResourceCategory;
  icon: 'rocket' | 'trending-up' | 'briefcase';
  tagline: string;
}[] = [
  { key: 'Getting Started', icon: 'rocket', tagline: 'Go from sign-up to your first sale' },
  { key: 'Marketing & Growth', icon: 'trending-up', tagline: 'Get your link in front of buyers' },
  { key: 'Operations & Money', icon: 'briefcase', tagline: 'Run the store and get paid' },
];

export const RESOURCE_GUIDES: ResourceGuide[] = [
  {
    slug: 'first-products',
    title: 'Your First 5 Products',
    time: '12 min',
    category: 'Getting Started',
    blurb: 'Pick, photograph, price and describe the products that open your store.',
  },
  {
    slug: 'launching-your-store',
    title: 'Launching Your Store',
    time: '6 min',
    category: 'Getting Started',
    blurb: 'What "draft" vs "live" means, the launch checklist, and going public.',
  },
  {
    slug: 'sharing-your-store',
    title: 'Sharing Your Store',
    time: '7 min',
    category: 'Marketing & Growth',
    blurb: 'Where your link belongs — bio, status, posts — and how to get the first orders.',
  },
  {
    slug: 'promo-codes',
    title: 'Running Promo Codes',
    time: '6 min',
    category: 'Marketing & Growth',
    blurb: 'Use free-delivery codes for launches, slow weeks and repeat buyers.',
  },
  {
    slug: 'delivery',
    title: 'Setting Up Delivery',
    time: '8 min',
    category: 'Operations & Money',
    blurb: 'Deliver it yourself or hand off to a courier, and set a fee that pays for itself.',
  },
  {
    slug: 'payment-setup',
    title: 'Getting Paid',
    time: '5 min',
    category: 'Operations & Money',
    blurb: 'How money reaches you — card payouts, Cash App / Zelle withdrawals, 0% fees.',
  },
];

export function guideHref(slug: string): string {
  return `/dashboard/resources/${slug}`;
}

export function guidesByCategory(category: ResourceCategory): ResourceGuide[] {
  return RESOURCE_GUIDES.filter((g) => g.category === category);
}

/** The two other guides in the same category — for a guide page's "Related" block. */
export function relatedGuides(slug: string): { title: string; time: string; href: string }[] {
  const self = RESOURCE_GUIDES.find((g) => g.slug === slug);
  const pool = self
    ? RESOURCE_GUIDES.filter((g) => g.category === self.category && g.slug !== slug)
    : [];
  const fill = RESOURCE_GUIDES.filter((g) => g.slug !== slug && !pool.includes(g));
  return [...pool, ...fill].slice(0, 2).map((g) => ({
    title: g.title,
    time: g.time,
    href: guideHref(g.slug),
  }));
}
