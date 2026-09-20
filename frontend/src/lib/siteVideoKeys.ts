// Fixed manifest of the landing page's superadmin-editable video slots —
// same convention as siteImageKeys.ts (SITE_IMAGE_KEYS). Only one slot today
// (the clip below the homepage hero); a slot with no SiteVideo row yet means
// nobody has uploaded one, and the marketing component simply doesn't render
// that section (no placeholder video).
export const SITE_VIDEO_KEYS = [
  {
    key: 'landing_hero_video',
    label: 'Hero film',
    hint: 'The scroll-scrubbed film at the very top of the homepage. MP4 or WebM, up to 100MB. The poster shows before it loads and while it plays back on scroll.',
  },
  {
    key: 'landing_intro_video',
    label: 'Intro section video',
    hint: 'Click-to-play video in the "You bring the ambition..." section, just below the hero. MP4 or WebM, up to 100MB. Shows a poster image until the visitor presses play.',
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
