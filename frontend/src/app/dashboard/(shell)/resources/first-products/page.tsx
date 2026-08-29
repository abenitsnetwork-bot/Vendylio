'use client';

import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { GuideLayout, type GuideStep } from '@/components/seller/GuideLayout';
import { relatedGuides } from '@/lib/resourceGuides';

const STEPS: GuideStep[] = [
  {
    number: 1,
    title: 'Choose Your First Products',
    description:
      'Start with 5 best-sellers or most popular items. Focus on items with high profit margins and strong demand.',
    tips: [
      'Pick products you know well',
      'Consider seasonal demand',
      'Include different price points',
      'Test high-margin items first',
    ],
  },
  {
    number: 2,
    title: 'Take Quality Photos',
    description:
      'Good photos are essential. Show your product from multiple angles with clear, natural lighting.',
    tips: [
      'Use natural lighting, avoid shadows',
      'Show product from 3-4 angles',
      'Include a lifestyle shot if possible',
      'Ensure images are at least 1200px wide',
    ],
  },
  {
    number: 3,
    title: 'Write Compelling Descriptions',
    description:
      'Your description should sell the product. Highlight key features, benefits, and use cases.',
    tips: [
      'Start with the main benefit',
      'List key ingredients or materials',
      'Include size and weight information',
      'Add care or usage instructions',
    ],
  },
  {
    number: 4,
    title: 'Set Your Prices Competitively',
    description: 'Research what competitors charge. Factor in your costs, time, and market rates.',
    tips: [
      'Research competitor pricing',
      'Calculate your cost + markup',
      'Consider bulk discounts',
      'Round prices strategically ($9.99 vs $10)',
    ],
  },
  {
    number: 5,
    title: 'Optimize for Search',
    description:
      'Use keywords customers search for. This helps your products appear in relevant searches.',
    tips: [
      'Use product category wisely',
      'Include keywords in title and description',
      'Use common product names',
      'Avoid generic descriptions',
    ],
  },
];

export default function GuideFirstProductsPage() {
  const user = useUser();
  const { logout } = useAuth();
  if (!user) return null;

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerHeader
        userName={sellerFirstName(user)}
        userEmail={user.email}
        onSignOut={async () => {
          await logout();
        }}
      />
      <div className="px-4 py-12 lg:px-14">
        <GuideLayout
          category="Getting Started"
          title="Your First 5 Products"
          description="A practical guide to adding your first products to Vendylio and getting ready for your first sale."
          readTime="12 min read"
          steps={STEPS}
          relatedGuides={relatedGuides('first-products')}
          ctaText="Go to Product Manager"
          ctaHref="/dashboard/products/new"
          extraContent={
            <div className="my-12 rounded-lg bg-primary p-8 text-primary-foreground">
              <h3 className="mb-3 font-headings text-lg font-bold">The Takeaway</h3>
              <p className="text-base leading-relaxed opacity-90">
                Your first 5 products set the tone for your store. Quality photos, clear
                descriptions, and strategic pricing will help you make your first sales. Don&apos;t
                overthink it—you can always update or add more products later. The key is to start
                now.
              </p>
            </div>
          }
        />
      </div>
    </div>
  );
}
