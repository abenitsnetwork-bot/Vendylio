export type SocialNetwork = 'instagram' | 'facebook' | 'twitter' | 'tiktok' | 'linkedin';

/** SiteSettings field <-> icon/label, shared by every social-link renderer
 * (marketing footer, contact page) so the two never drift. */
export const SOCIAL_NETWORKS: {
  key: 'instagramUrl' | 'facebookUrl' | 'twitterUrl' | 'tiktokUrl' | 'linkedinUrl';
  network: SocialNetwork;
  label: string;
}[] = [
  { key: 'instagramUrl', network: 'instagram', label: 'Instagram' },
  { key: 'facebookUrl', network: 'facebook', label: 'Facebook' },
  { key: 'twitterUrl', network: 'twitter', label: 'X (Twitter)' },
  { key: 'tiktokUrl', network: 'tiktok', label: 'TikTok' },
  { key: 'linkedinUrl', network: 'linkedin', label: 'LinkedIn' },
];

const PATHS: Record<'facebook' | 'linkedin' | 'tiktok', string> = {
  facebook:
    'M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.573-.011c-.591 0-1.058.076-1.428.229-.37.152-.637.361-.822.628-.185.267-.297.596-.35.988-.048.352-.075.732-.084 1.129v1.008h3.68l-.301 1.867-.3 1.8h-3.08v7.979H9.101z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  tiktok:
    'M16.6 5.82c-1.02-1-1.63-2.35-1.7-3.82h-3.44v13.61c0 1.65-1.34 3-3 3-1.65 0-3-1.35-3-3s1.35-3 3-3c.31 0 .62.05.9.13V9.28c-.3-.04-.6-.06-.9-.06-3.57 0-6.46 2.9-6.46 6.47S8.89 22.16 12.46 22.16s6.46-2.9 6.46-6.47V9.02c1.38.98 3.07 1.56 4.88 1.56V7.14c-1.03 0-2.05-.32-2.89-.94-.49-.36-.94-.86-1.31-1.38z',
};

/**
 * Small monochrome brand glyphs for social footer/contact links —
 * hand-inlined (no new dependency for five icons; lucide-react, the app's
 * icon set, dropped brand logos years ago). Instagram and X/Twitter are
 * drawn from primitive shapes rather than a memorized complex path, so
 * they render crisply at any size instead of risking a garbled glyph.
 */
export function SocialIcon({
  network,
  size = 18,
  className,
}: {
  network: SocialNetwork;
  size?: number;
  className?: string;
}) {
  if (network === 'instagram') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className={className}
        aria-hidden="true"
      >
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
        <circle cx="12" cy="12" r="4.6" />
        <circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (network === 'twitter') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        className={className}
        aria-hidden="true"
      >
        <line x1="4" y1="4" x2="20" y2="20" />
        <line x1="20" y1="4" x2="4" y2="20" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[network]} />
    </svg>
  );
}
