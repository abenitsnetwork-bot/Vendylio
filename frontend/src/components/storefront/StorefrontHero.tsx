'use client';

import { useEffect, useState } from 'react';
import type { StoreHero } from '@/lib/storeHero';

const ADVANCE_MS = 5000;

/**
 * Storefront hero carousel — up to 3 uploaded images that auto-advance, with
 * one global promo message overlaid. Renders nothing when the store has no
 * hero images configured, so the storefront looks exactly as before for
 * everyone who hasn't set one up.
 *
 * No carousel library: a CSS scroll-snap track + a timer that nudges
 * scrollLeft. Swipe works natively on touch; the dots are tappable.
 */
export function StorefrontHero({ hero, storeName }: { hero: StoreHero; storeName: string }) {
  const images = hero.images;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (images.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % images.length), ADVANCE_MS);
    return () => clearInterval(id);
  }, [images.length]);

  if (images.length === 0) return null;

  const headline = hero.headline?.trim();
  const subhead = hero.subhead?.trim();

  return (
    <section
      aria-label={`${storeName} — featured`}
      aria-roledescription="carousel"
      className="mx-auto max-w-7xl px-4 pt-4 lg:px-14"
    >
      <div className="relative overflow-hidden rounded-2xl bg-secondary">
        <div className="relative aspect-[4/3] w-full sm:aspect-[2/1] lg:aspect-[21/9]">
          {images.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
                i === index ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ))}

          {(headline || subhead) && (
            <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/65 via-black/20 to-transparent p-5 sm:p-8">
              {headline && (
                <p
                  className="font-headings font-bold text-white"
                  style={{ fontSize: 'clamp(20px, 3.5vw, 36px)', letterSpacing: '-0.5px' }}
                >
                  {headline}
                </p>
              )}
              {subhead && (
                <p className="mt-1 max-w-xl text-sm text-white/85 sm:text-base">{subhead}</p>
              )}
            </div>
          )}
        </div>

        {images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {images.map((src, i) => (
              <button
                key={src}
                type="button"
                aria-label={`Show slide ${i + 1}`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/50'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
