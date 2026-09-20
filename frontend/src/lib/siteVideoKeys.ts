// Fixed manifest of the landing page's superadmin-editable video slots —
// same convention as siteImageKeys.ts (SITE_IMAGE_KEYS). Only one slot today
// (the clip below the homepage hero); a slot with no SiteVideo row yet means
// nobody has uploaded one, and the marketing component simply doesn't render
// that section (no placeholder video).
export const SITE_VIDEO_KEYS = [
  {
    key: 'landing_hero_video',
    label: 'Homepage video',
    hint: 'Shown below the hero section on the public homepage. MP4 or WebM, up to 100MB.',
  },
] as const;

export type SiteVideoKey = (typeof SITE_VIDEO_KEYS)[number]['key'];

export const SITE_VIDEO_KEY_VALUES = SITE_VIDEO_KEYS.map((k) => k.key) as [
  SiteVideoKey,
  ...SiteVideoKey[],
];

export function isSiteVideoKey(value: string): value is SiteVideoKey {
  return (SITE_VIDEO_KEY_VALUES as readonly string[]).includes(value);
}
