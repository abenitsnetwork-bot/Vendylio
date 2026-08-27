'use client';

import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { GuideLayout, type GuideStep } from '@/components/seller/GuideLayout';

const STEPS: GuideStep[] = [
  {
    number: 1,
    title: 'Determine Your Service Area',
    description:
      'Decide which neighborhoods or cities you want to serve. Start local to manage logistics efficiently.',
    tips: [
      'Start with a 5-10 mile radius',
      'Include your home/business location',
      'Consider drive time for deliveries',
      'Expand gradually as you grow',
    ],
  },
  {
    number: 2,
    title: 'Set Your Delivery Options',
    description:
      'Choose between same-day, next-day, or both. Different options appeal to different customers.',
    tips: [
      'Same-day delivery: boost urgency',
      'Next-day: predictable for customers',
      'Offer both for maximum flexibility',
      'Same-day prep time: 1-3 hours',
    ],
  },
  {
    number: 3,
    title: 'Choose Your Delivery Method',
    description: "Decide how you'll deliver: personal, third-party service, or hybrid approach.",
    tips: [
      'Personal delivery: full control, scalable',
      'Third-party: delegate logistics',
      'Hybrid: use both based on volume',
      'Factor in time and vehicle costs',
    ],
  },
  {
    number: 4,
    title: 'Set Delivery Fees',
    description:
      'Charge appropriately for delivery. Consider distance, order size, and market rates.',
    tips: [
      'Free delivery for orders over $X',
      'Flat rate per area ($3-$5)',
      'Distance-based: $0.50 per mile',
      'Always display upfront in checkout',
    ],
  },
  {
    number: 5,
    title: 'Communicate Clearly',
    description:
      'Set customer expectations about delivery timing, tracking, and contact information.',
    tips: [
      'Post delivery hours prominently',
      'Include tracking capability',
      'Provide your contact number',
      'Send order confirmation & updates',
    ],
  },
];

export default function GuideDeliveryPage() {
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
          category="Logistics & Fulfillment"
          title="Setting Up Delivery"
          description="Configure your delivery zones, set realistic timelines, and establish a system that scales with your growth."
          readTime="8 min read"
          steps={STEPS}
          relatedGuides={[
            {
              title: 'Your First 5 Products',
              time: '12 min',
              href: '/dashboard/resources/first-products',
            },
            { title: 'Payment Setup', time: '5 min', href: '/dashboard/resources/payment-setup' },
          ]}
          ctaText="Go to Store Settings"
          ctaHref="/dashboard/settings"
          extraContent={
            <>
              <div className="my-12 rounded-lg border border-border p-8">
                <h3 className="mb-4 flex items-center gap-2 font-headings text-lg font-bold text-foreground">
                  <Icon i="lightbulb" size={20} className="text-primary" />
                  Pro Tips for Success
                </h3>
                <ul className="space-y-3">
                  {[
                    'Offer same-day delivery as a premium option to stand out from competitors.',
                    'Use a map tool to visualize your delivery zones and calculate realistic times.',
                    "Start conservative with delivery times; it's easier to deliver early than late.",
                    'Track your delivery costs carefully to ensure profitability.',
                  ].map((tip) => (
                    <li key={tip} className="flex gap-3">
                      <Icon
                        i="arrow-right"
                        size={16}
                        className="mt-0.5 flex-shrink-0 text-primary"
                      />
                      <span className="text-muted-foreground">{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mb-12 rounded-lg border border-border bg-secondary p-8">
                <h3 className="mb-4 flex items-center gap-2 font-headings text-lg font-bold text-foreground">
                  <Icon i="alert-circle" size={20} className="text-primary" />
                  Common Mistakes to Avoid
                </h3>
                <ul className="space-y-3">
                  {[
                    'Setting unrealistic delivery times. Always add buffer time.',
                    'Offering free delivery without calculating actual costs.',
                    'Expanding service area too quickly before optimizing operations.',
                    'Not communicating delivery policies clearly to customers.',
                  ].map((mistake) => (
                    <li key={mistake} className="flex gap-3">
                      <span className="text-lg font-bold text-primary">✕</span>
                      <span className="text-muted-foreground">{mistake}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}
