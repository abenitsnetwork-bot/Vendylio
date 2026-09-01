// PERF-01 (Prompt #15) — client-safe Cloudinary URL transforms for the
// storefront. Product images are stored as raw Cloudinary `secure_url`s and
// were rendered at full resolution with no lazy-loading. This injects
// `f_auto,q_auto` (WebP/AVIF + auto quality) and a width cap into the delivery
// URL — Cloudinary's own on-the-fly transform, so nothing about upload or
// storage changes. A non-Cloudinary URL (or a data: URI) is returned untouched.

const CLOUDINARY_UPLOAD_RE = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/;

export interface CloudinaryTransformOpts {
  /** Target display width in CSS px. Cloudinary caps the longest edge to this. */
  width: number;
  /** `c_limit` (never upscale, keep aspect) or `c_fill` (crop to box). */
  crop?: 'limit' | 'fill';
  /** Only meaningful with crop:'fill'. */
  height?: number;
}

/** A single transformed URL. Pass a device-pixel-ratio-aware width for `@2x`. */
export function cloudinaryUrl(src: string, opts: CloudinaryTransformOpts): string {
  const m = CLOUDINARY_UPLOAD_RE.exec(src);
  if (!m) return src;
  const [, prefix, rest] = m;
  // If the URL already carries a leading transform segment, keep it and prepend
  // ours (Cloudinary chains left-to-right).
  const t = [
    'f_auto',
    'q_auto',
    `w_${Math.round(opts.width)}`,
    ...(opts.crop === 'fill' && opts.height
      ? [`h_${Math.round(opts.height)}`, 'c_fill']
      : ['c_limit']),
  ].join(',');
  return `${prefix}${t}/${rest}`;
}

/**
 * `srcSet` at 1x + 2x for a given CSS width. `sizes` is the caller's problem
 * (it depends on layout) — pass a sensible one to the <img>.
 */
export function cloudinarySrcSet(src: string, cssWidth: number, crop: 'limit' | 'fill' = 'limit') {
  if (!CLOUDINARY_UPLOAD_RE.test(src)) return undefined;
  const w1 = cloudinaryUrl(src, { width: cssWidth, crop });
  const w2 = cloudinaryUrl(src, { width: cssWidth * 2, crop });
  return `${w1} 1x, ${w2} 2x`;
}
