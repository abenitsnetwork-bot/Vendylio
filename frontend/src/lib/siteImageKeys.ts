// Fixed manifest of the landing page's superadmin-editable image slots. Not
// a free-form CMS field list — every slot the homepage actually renders has
// an entry here, and the admin UI / API only ever accept one of these keys.
// A slot with no SiteImage row yet (nobody's uploaded to it) falls back to
// the existing ImagePlaceholder in the marketing components.
export const SITE_IMAGE_KEYS = [
  {
    key: 'hero_showcase',
    label: 'Hero showcase',
    hint: 'The large image in the homepage hero (desktop dark panel + mobile stand-in).',
  },
  {
    key: 'hero_product',
    label: 'Hero product card',
    hint: 'The small floating product photo at the bottom of the hero (desktop only).',
  },
  {
    key: 'feature_store_builder',
    label: 'Feature — Store Builder',
    hint: 'Illustration for the "Store Builder" feature card.',
  },
  {
    key: 'feature_payment_gateway',
    label: 'Feature — Payment Gateway',
    hint: 'Illustration for the "Payment Gateway" feature card.',
  },
  {
    key: 'feature_delivery',
    label: 'Feature — Same-Day Delivery',
    hint: 'Illustration for the "Same-Day Delivery" feature card.',
  },
] as const;

export type SiteImageKey = (typeof SITE_IMAGE_KEYS)[number]['key'];

export const SITE_IMAGE_KEY_VALUES = SITE_IMAGE_KEYS.map((k) => k.key) as [
  SiteImageKey,
  ...SiteImageKey[],
];

export function isSiteImageKey(value: string): value is SiteImageKey {
  return (SITE_IMAGE_KEY_VALUES as readonly string[]).includes(value);
}
