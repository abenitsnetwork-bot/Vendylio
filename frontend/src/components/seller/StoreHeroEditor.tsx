'use client';

import { Field, inputClass } from '@/components/ui/Field';
import { ImageDropzone } from '@/components/ui/ImageDropzone';
import { MAX_HERO_IMAGES } from '@/lib/storeHero';

/**
 * Seller-side editor for the storefront hero carousel — up to 3 images plus
 * one global promo message. Fully controlled; used both in onboarding
 * (/onboarding/brand) and Settings → Store.
 */
export function StoreHeroEditor({
  images,
  headline,
  subhead,
  onImagesChange,
  onHeadlineChange,
  onSubheadChange,
}: {
  images: string[];
  headline: string;
  subhead: string;
  onImagesChange: (next: string[]) => void;
  onHeadlineChange: (next: string) => void;
  onSubheadChange: (next: string) => void;
}) {
  function replaceAt(i: number, url: string) {
    const next = [...images];
    next[i] = url;
    onImagesChange(next);
  }
  function removeAt(i: number) {
    onImagesChange(images.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-foreground">
          Hero photos <span className="font-normal text-muted-foreground">(optional)</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Up to {MAX_HERO_IMAGES} photos that rotate at the top of your storefront. Leave empty to
          keep the plain header.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {images.map((url, i) => (
            <ImageDropzone
              key={`${url}-${i}`}
              label="Replace"
              hint={`Slide ${i + 1}`}
              value={url}
              onUploaded={(u) => replaceAt(i, u)}
              onRemove={() => removeAt(i)}
            />
          ))}
          {images.length < MAX_HERO_IMAGES && (
            <ImageDropzone
              label="Add a photo"
              hint="PNG, JPG, WebP up to 5MB"
              value={null}
              onUploaded={(u) => onImagesChange([...images, u])}
            />
          )}
        </div>
      </div>

      <Field label="Promo headline" htmlFor="heroHeadline">
        <input
          id="heroHeadline"
          type="text"
          maxLength={80}
          value={headline}
          onChange={(e) => onHeadlineChange(e.target.value)}
          placeholder="Fresh groceries, delivered in under an hour"
          className={inputClass}
        />
      </Field>

      <Field label="Promo sub-line" htmlFor="heroSubhead">
        <input
          id="heroSubhead"
          type="text"
          maxLength={160}
          value={subhead}
          onChange={(e) => onSubheadChange(e.target.value)}
          placeholder="Locally sourced. Same-day pickup or delivery."
          className={inputClass}
        />
      </Field>
    </div>
  );
}
