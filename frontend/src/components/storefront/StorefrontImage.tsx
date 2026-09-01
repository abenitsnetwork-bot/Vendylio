// PERF-01 — the one <img> the storefront uses for product photos. Wraps a raw
// Cloudinary URL with an on-the-fly f_auto,q_auto,w_<n> transform + a 1x/2x
// srcSet, lazy-loads, and decodes async. A non-Cloudinary URL falls back to a
// plain lazy <img>. Callers pass `displayWidth` (the CSS px the image renders
// at on a phone — the largest common case) and a `sizes` hint.
import { cloudinaryUrl, cloudinarySrcSet } from '@/lib/cloudinaryImage';

export function StorefrontImage({
  src,
  alt,
  displayWidth,
  sizes,
  crop = 'fill',
  className,
  priority = false,
}: {
  src: string;
  alt: string;
  displayWidth: number;
  sizes?: string;
  crop?: 'limit' | 'fill';
  className?: string;
  priority?: boolean;
}) {
  const srcSet = cloudinarySrcSet(src, displayWidth, crop);
  return (
    <img
      src={cloudinaryUrl(src, { width: displayWidth, crop })}
      {...(srcSet ? { srcSet } : {})}
      {...(sizes ? { sizes } : {})}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={className}
    />
  );
}
