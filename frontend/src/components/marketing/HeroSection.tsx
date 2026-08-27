import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import type { LandingImage } from '@/lib/server/landing';

interface HeroSectionProps {
  showcaseImage?: LandingImage | undefined;
  productImage?: LandingImage | undefined;
}

/** Curved "TRUSTED BY SELLERS" badge arcing over a center arrow — the
 * circular-text signature element from the reference theme. */
function TrustedBadge() {
  return (
    <div className="absolute left-6 top-6 z-20 h-28 w-28 lg:-left-8 lg:top-10">
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          strokeWidth="1"
          strokeDasharray="2 4"
          className="stroke-panel-foreground/40"
        />
        <path id="trusted-badge-arc" fill="none" d="M 8,50 A 42,42 0 1 1 92,50" />
        <text className="fill-panel-foreground text-[9px] font-semibold uppercase tracking-[0.2em]">
          <textPath href="#trusted-badge-arc" startOffset="50%" textAnchor="middle">
            Trusted by Sellers · Trusted by Sellers ·
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon i="arrow-down" size={16} className="text-panel-foreground" />
      </div>
    </div>
  );
}

/** Small floating UI callout, styled like the ones scattered around the
 * showcase image (Invoice/Store Theme) — a compact white card that reads as
 * "here's a glimpse of the actual product", not decoration. */
function StoreThemeCard() {
  const themes = [
    { name: 'Bold', active: false },
    { name: 'Modern', active: true },
    { name: 'Minimal', active: false },
  ];
  return (
    <div className="absolute bottom-28 left-8 z-20 w-44 rounded-2xl bg-card p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Store Theme</p>
        <Icon i="arrow-right" size={12} className="text-muted-foreground" />
      </div>
      <div className="space-y-1">
        {themes.map((t) => (
          <p
            key={t.name}
            className={`rounded-lg px-2 py-1 text-xs ${
              t.active ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground'
            }`}
          >
            {t.name}
          </p>
        ))}
      </div>
    </div>
  );
}

export function HeroSection({ showcaseImage, productImage }: HeroSectionProps) {
  return (
    <section className="bg-background px-4 pb-16 pt-8 font-body lg:px-14 lg:pt-12">
      <div className="mx-auto max-w-7xl">
        {/* Outer wrapper has NO overflow-hidden — the floating cards below
         * deliberately straddle the rounded box's edge and must not be
         * clipped. Corner-rounding/clipping lives on the inner box instead
         * (only it needs to hide the copy/showcase panels' square corners). */}
        <div className="relative">
          <div className="relative overflow-hidden rounded-3xl bg-background lg:grid lg:min-h-[720px] lg:grid-cols-2">
            {/* Copy (light side) */}
            <div className="relative z-10 flex flex-col justify-center px-1 py-8 lg:px-4 lg:py-16 lg:pr-16">
              <p className="mb-4 text-xs font-bold uppercase tracking-[0.15em] text-foreground">
                Join <span className="text-accent">1,200+</span> sellers already selling
              </p>
              <h1
                className="mb-5 font-headings font-bold leading-[0.95] text-foreground"
                style={{ fontSize: 'clamp(36px, 6vw, 60px)', letterSpacing: '-1px' }}
              >
                Your Business.
                <br />
                Online. Delivered.
              </h1>
              <p className="mb-8 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Turn your business idea into reality. Build your online store in minutes, then start
                selling to customers everywhere. It&apos;s that simple.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/register"
                  className="rounded-full bg-primary px-7 py-3.5 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
                >
                  Open Store Now
                </Link>
                <a
                  href="#how-it-works"
                  className="rounded-full border border-border bg-card px-7 py-3.5 text-center text-sm font-semibold text-foreground hover:bg-secondary"
                >
                  How It Works
                </a>
              </div>

              {/* Mobile-only stand-in for the dark showcase panel */}
              {showcaseImage ? (
                <img
                  src={showcaseImage.url}
                  alt={showcaseImage.altText ?? ''}
                  className="mt-8 h-56 w-full rounded-2xl object-cover sm:h-72 lg:hidden"
                />
              ) : (
                <ImagePlaceholder
                  icon="smartphone"
                  className="mt-8 h-56 w-full rounded-2xl sm:h-72 lg:hidden"
                />
              )}
              <div className="mt-8 flex flex-col gap-3 lg:hidden">
                <div className="flex w-fit items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary">
                    <Icon i="check" size={14} className="text-primary-foreground" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">Order Received #87652</p>
                    <p className="text-xs text-muted-foreground">Shea butter 250g — $18.00</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Showcase (dark side, lg+) */}
            <div className="relative hidden overflow-hidden bg-panel lg:block">
              <TrustedBadge />

              <div className="absolute inset-0 flex items-end justify-center pb-10 pt-10">
                {showcaseImage ? (
                  <img
                    src={showcaseImage.url}
                    alt={showcaseImage.altText ?? ''}
                    className="h-[560px] w-[560px] rounded-full object-cover"
                  />
                ) : (
                  <ImagePlaceholder icon="smartphone" rounded className="h-[560px] w-[560px]" />
                )}
              </div>

              <div
                className="absolute right-8 top-10 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg"
                style={{ minWidth: '190px' }}
              >
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent">
                  <Icon i="check" size={14} className="text-accent-foreground" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">Invoice sent to Amara</p>
                  <p className="text-xs text-muted-foreground">$36.00 · Confirmed</p>
                </div>
              </div>

              <StoreThemeCard />
            </div>
          </div>

          {/* Floating cards straddling the seam — desktop only, siblings of
           * the clipped box above so they can spill past its bottom edge. */}
          <div
            className="absolute bottom-10 z-20 hidden rounded-2xl bg-panel px-5 py-4 text-panel-foreground shadow-xl lg:block"
            style={{ left: '41%' }}
          >
            <p className="font-headings text-2xl font-bold">1,200+</p>
            <p className="mb-2 text-xs opacity-80">Happy Sellers</p>
            <div className="flex -space-x-2">
              {['A', 'F', 'K', 'M'].map((letter) => (
                <div
                  key={letter}
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-panel bg-accent text-[10px] font-bold text-accent-foreground"
                >
                  {letter}
                </div>
              ))}
            </div>
          </div>

          <div className="absolute -bottom-10 left-6 z-20 hidden w-80 items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-xl lg:flex">
            {productImage ? (
              <img
                src={productImage.url}
                alt={productImage.altText ?? ''}
                className="h-20 w-20 flex-shrink-0 rounded-xl object-cover"
              />
            ) : (
              <ImagePlaceholder icon="package" className="h-20 w-20 flex-shrink-0 rounded-xl" />
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">Shea Butter 250g</p>
              <p className="text-sm text-muted-foreground">★★★★★ · $18.00</p>
            </div>
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary">
              <Icon i="shopping-bag" size={18} className="text-primary-foreground" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
