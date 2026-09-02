'use client';

import { sellerFirstName } from '@/lib/utils';
import { useAuth, useUser } from '@/contexts/AuthContext';
import { Icon } from '@/components/ui/Icon';
import { SellerHeader } from '@/components/seller/SellerHeader';
import { GuideLayout, type GuideStep } from '@/components/seller/GuideLayout';
import { relatedGuides } from '@/lib/resourceGuides';

const STEPS: GuideStep[] = [
  {
    number: 1,
    title: 'Know the difference: draft vs live',
    description:
      'A brand-new store is a private draft. Its link (vendylio.com/s/your-store) shows "not found" to everyone except you until you launch it. Nothing you build is visible to customers before then.',
    tips: [
      'You can take all the time you need in draft',
      'Only you, while signed in, can open the draft link',
      'Launching is one click and is reversible',
      'A live store can still be paused separately for holidays',
    ],
  },
  {
    number: 2,
    title: 'Clear the launch checklist',
    description:
      'The Launch step shows exactly what is required and what is optional. Only two things are required: your business details and at least one active product.',
    tips: [
      'Required: store name + one active (not draft) product',
      'Optional: logo, branding, hero images, payments, delivery',
      'Optional items can be added any time from Settings',
      'The checklist updates live as you complete each item',
    ],
  },
  {
    number: 3,
    title: 'Preview it as a customer would',
    description:
      'From the Launch or Preview step, open your store link. While signed in you will see the real storefront with a "Preview — not live yet" banner on top.',
    tips: [
      'Check your prices, photos and product order',
      'Try adding something to the cart',
      'Look at it on your phone, not just your laptop',
      'Fix anything that looks off before launching',
    ],
  },
  {
    number: 4,
    title: 'Launch',
    description:
      'Press "Launch My Store". Vendylio re-checks that you still have an active product, then makes the store public immediately — the link works for anyone and orders can come in.',
    tips: [
      'The moment is recorded as your "live since" date',
      'Your storefront link never changes, so share it freely',
      'If a product got archived in another tab, launch is blocked until you fix it',
      'Pressing launch twice is harmless',
    ],
  },
  {
    number: 5,
    title: 'If you need to go back offline',
    description:
      'From Settings you can unpublish the store. It returns to draft — the link 404s and checkout stops — without losing any products, orders or your original launch date.',
    tips: [
      'Use unpublish for a real break or a big catalogue redo',
      'For a short pause that keeps the store visible, use "Pause orders" instead',
      'Re-launching later keeps your original "live since" date',
      'Orders already placed are unaffected',
    ],
  },
];

export default function GuideLaunchingYourStorePage() {
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
          title="Launching Your Store"
          description="Your store stays private until you say otherwise. Here's how the draft, preview and launch steps fit together."
          readTime="6 min read"
          steps={STEPS}
          relatedGuides={relatedGuides('launching-your-store')}
          ctaText="Go to the Launch step"
          ctaHref="/onboarding/launch"
          extraContent={
            <div className="my-12 rounded-lg border border-border bg-secondary p-8">
              <h3 className="mb-4 flex items-center gap-2 font-headings text-lg font-bold text-foreground">
                <Icon i="lightbulb" size={20} className="text-accent" />
                Draft, live, paused — which is which
              </h3>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li className="flex gap-3">
                  <span className="font-semibold text-foreground">Draft</span>
                  <span>Link 404s for everyone but you. The state every new store starts in.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-foreground">Live</span>
                  <span>Public and taking orders. This is what "launched" means.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-foreground">Paused</span>
                  <span>
                    Live and visible, but the storefront shows a message and checkout is blocked —
                    for a short break.
                  </span>
                </li>
              </ul>
            </div>
          }
        />
      </div>
    </div>
  );
}
