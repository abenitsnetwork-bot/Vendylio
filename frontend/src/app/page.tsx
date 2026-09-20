// Public homepage — Server Component with a direct data read (mirrors the
// storefront page's pattern, see s/[slug]/page.tsx) so superadmin-edited
// photos/video/testimonials show up without any client-side fetch or
// caching to invalidate.
//
// `dynamic = 'force-dynamic'` is required here specifically (unlike
// s/[slug], which is automatically dynamic because it reads a route param):
// this page has no dynamic segment and no cookies()/headers() call, so
// without this Next would treat the Prisma read as build-time-only and bake
// the current DB state into a static page — a superadmin's edit in
// /admin/site-content would then only appear after the next `next build`.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { getLandingPageContent } from '@/lib/server/landing';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { CtaFooter } from '@/components/marketing/CtaFooter';
import { TestimonialSection } from '@/components/marketing/TestimonialSection';
import { LandingMotion } from '@/components/marketing/landing/LandingMotion';
import { HeroFilm } from '@/components/marketing/landing/HeroFilm';
import { IntroEditorial } from '@/components/marketing/landing/IntroEditorial';
import { JourneySteps } from '@/components/marketing/landing/JourneySteps';
import { DeliveryMethods } from '@/components/marketing/landing/DeliveryMethods';
import { PricingSection } from '@/components/marketing/landing/PricingSection';
import { FaqSection } from '@/components/marketing/landing/FaqSection';
import { ClosingSection } from '@/components/marketing/landing/ClosingSection';
import '@/components/marketing/landing/landing.css';

export default async function HomePage() {
  const { images, testimonials, videos } = await getLandingPageContent();

  return (
    <div className="bg-background font-body">
      <PublicNavBar />
      <LandingMotion>
        <main>
          <HeroFilm
            video={videos.landing_hero_video ?? null}
            showcaseImage={images.hero_showcase}
          />
          <IntroEditorial
            video={videos.landing_intro_video ?? null}
            showcaseImage={images.hero_showcase}
            productImage={images.hero_product}
          />
          <JourneySteps images={images} />
          <DeliveryMethods image={images.feature_delivery} />
          <PricingSection />
          <FaqSection />
          <ClosingSection />
        </main>
      </LandingMotion>
      <TestimonialSection testimonials={testimonials} />
      <CtaFooter />
    </div>
  );
}
