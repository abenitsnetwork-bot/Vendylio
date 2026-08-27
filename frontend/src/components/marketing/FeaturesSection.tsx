import { type IconName } from '@/components/ui/Icon';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import type { SiteImageKey } from '@/lib/siteImageKeys';
import type { LandingImage } from '@/lib/server/landing';

const FEATURES: { icon: IconName; title: string; desc: string; imageKey: SiteImageKey }[] = [
  {
    icon: 'smartphone',
    title: 'Store Builder',
    desc: 'Set up your store from your phone in minutes. No technical skills needed.',
    imageKey: 'feature_store_builder',
  },
  {
    icon: 'credit-card',
    title: 'Payment Gateway',
    desc: 'Accept Cash App, Zelle, and card payments seamlessly.',
    imageKey: 'feature_payment_gateway',
  },
  {
    icon: 'truck',
    title: 'Same-Day Delivery',
    desc: 'Deliver the same day via Uber Direct. You sell, they drive.',
    imageKey: 'feature_delivery',
  },
];

export function FeaturesSection({
  images = {},
}: {
  images?: Partial<Record<SiteImageKey, LandingImage>>;
}) {
  return (
    <section id="features" className="bg-background px-4 py-16 font-body lg:px-14 lg:py-20">
      <div className="mx-auto mb-10 max-w-7xl text-center lg:mb-12">
        <h2
          className="mb-3 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(26px, 4vw, 36px)', letterSpacing: '-0.8px' }}
        >
          Launch your store with everything you need
        </h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Everything you need to manage and grow your business is right here, seamlessly integrated
          into one platform.
        </p>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="overflow-hidden rounded-xl border border-border bg-card">
            {images[f.imageKey] ? (
              <img
                src={images[f.imageKey]!.url}
                alt={images[f.imageKey]!.altText ?? ''}
                className="h-48 w-full object-cover"
              />
            ) : (
              <ImagePlaceholder icon={f.icon} className="h-48 w-full" />
            )}
            <div className="p-6">
              <p className="mb-2 font-headings text-base font-semibold text-foreground">
                {f.title}
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
