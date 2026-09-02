// Public homepage — Server Component with a direct data read (mirrors the
// storefront page's pattern, see s/[slug]/page.tsx) so superadmin-edited
// photos/testimonials show up without any client-side fetch or caching to
// invalidate.
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
import { HeroSection } from '@/components/marketing/HeroSection';
import { HowItWorksSection } from '@/components/marketing/HowItWorksSection';
import { FeaturesSection } from '@/components/marketing/FeaturesSection';
import { PlansSection } from '@/components/marketing/PlansSection';
import { TestimonialSection } from '@/components/marketing/TestimonialSection';
import { CtaFooter } from '@/components/marketing/CtaFooter';

export default async function HomePage() {
  const { images, testimonials, sellerCount } = await getLandingPageContent();

  return (
    <div className="bg-background font-body">
      <PublicNavBar />
      <HeroSection
        showcaseImage={images.hero_showcase}
        productImage={images.hero_product}
        sellerCount={sellerCount}
      />
      <HowItWorksSection />
      <FeaturesSection images={images} />
      <PlansSection />
      <TestimonialSection testimonials={testimonials} />
      <CtaFooter />
    </div>
  );
}
