'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import type { LandingImage, LandingVideo } from '@/lib/server/landing';

interface IntroEditorialProps {
  video?: LandingVideo | null;
  showcaseImage?: LandingImage | undefined;
  productImage?: LandingImage | undefined;
}

const FALLBACK_PHOTO = '/assets/landing/editorial.webp';
const FALLBACK_ALT =
  'Shea butter, amber bottles, woven fabric and a parcel on a deep green worktable';

// "You bring the ambition..." — the first section after the hero film.
// Click-to-play video (SiteVideo key `landing_intro_video`, admin-uploaded
// via /admin/site-content) when one exists, with a poster shown until the
// visitor presses play — same not-autoplay convention as the old homepage
// VideoSection. Falls back to the still photo (hero_showcase, or the
// bundled default) when no video has been uploaded yet, so the section is
// never empty. The hero_product floating card stays regardless.
export function IntroEditorial({ video, showcaseImage, productImage }: IntroEditorialProps) {
  const [playing, setPlaying] = useState(false);
  const poster = video?.posterUrl ?? showcaseImage?.url ?? FALLBACK_PHOTO;

  return (
    <section id="possibility" className="intro section-pad">
      <div className="section-top">
        <p className="eyebrow">BUILT AROUND YOUR BUSINESS</p>
      </div>
      <div className="intro-copy lift">
        <h2>
          You bring the ambition.
          <br />
          <em>Give it a storefront.</em>
        </h2>
        <div>
          <p>
            The products you make. The things you source. The business you&rsquo;re building, one
            customer at a time.
          </p>
          <p>
            Vendylio brings your store, payments and fulfilment into one place, so your next step
            feels simpler.
          </p>
          <a className="text-link" href="/register">
            Let&rsquo;s make it happen <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
      <div className="editorial-wrap">
        <figure className="editorial-image">
          {video && playing ? (
            <video
              className="editorial-video"
              src={video.url}
              poster={poster}
              controls
              autoPlay
              playsInline
            />
          ) : (
            <>
              {showcaseImage || video ? (
                <img
                  className="parallax-image"
                  src={poster}
                  alt={showcaseImage?.altText ?? ''}
                  loading="lazy"
                />
              ) : (
                <img
                  className="parallax-image"
                  src={FALLBACK_PHOTO}
                  width="1536"
                  height="1024"
                  alt={FALLBACK_ALT}
                  loading="lazy"
                />
              )}
              {video ? (
                <button
                  type="button"
                  onClick={() => setPlaying(true)}
                  aria-label="Play video"
                  className="editorial-play"
                >
                  <span aria-hidden="true">
                    <Icon i="play" size={22} />
                  </span>
                </button>
              ) : (
                <figcaption>
                  <span>Made. Sourced. Loved.</span>
                  <span>A home for what you sell.</span>
                </figcaption>
              )}
            </>
          )}
        </figure>
        <div className="intro-product-card">
          {productImage ? (
            <img src={productImage.url} alt={productImage.altText ?? ''} />
          ) : (
            <ImagePlaceholder icon="package" />
          )}
          <div>
            <p>Shea Butter 250g</p>
            <p>★★★★★ · $18.00</p>
          </div>
        </div>
      </div>
    </section>
  );
}
