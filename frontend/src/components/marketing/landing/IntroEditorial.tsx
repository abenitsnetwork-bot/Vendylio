import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import type { LandingImage } from '@/lib/server/landing';

interface IntroEditorialProps {
  showcaseImage?: LandingImage | undefined;
  productImage?: LandingImage | undefined;
}

// "You bring the ambition..." — the first section after the hero film.
// Keeps the same two admin-editable photos the previous hero used
// (hero_showcase / hero_product via /admin/site-content) rather than the
// reference design's stock photo, so real store/product photography stays
// visible instead of being replaced by generic imagery.
export function IntroEditorial({ showcaseImage, productImage }: IntroEditorialProps) {
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
          {showcaseImage ? (
            <img
              className="parallax-image"
              src={showcaseImage.url}
              alt={showcaseImage.altText ?? ''}
              loading="lazy"
            />
          ) : (
            <img
              className="parallax-image"
              src="/assets/landing/editorial.webp"
              width="1536"
              height="1024"
              alt="Shea butter, amber bottles, woven fabric and a parcel on a deep green worktable"
              loading="lazy"
            />
          )}
          <figcaption>
            <span>Made. Sourced. Loved.</span>
            <span>A home for what you sell.</span>
          </figcaption>
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
