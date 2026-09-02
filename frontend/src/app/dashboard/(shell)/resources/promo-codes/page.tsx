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
    title: 'Decide what the code is for',
    description:
      'A promo code works best with a reason attached to it — a launch, a quiet week, a thank-you to repeat buyers. Right now Vendylio codes waive the delivery fee, which is the friction most local buyers hesitate on.',
    tips: [
      'Launch: "free delivery on your first order"',
      'Slow week: a code that runs Monday–Wednesday only',
      'Loyalty: a code you only send to past customers',
      'Minimum basket: require a subtotal so small orders stay profitable',
    ],
  },
  {
    number: 2,
    title: 'Create the code',
    description:
      'Go to Promo codes, add a code (letters and numbers, it is stored uppercase), and it is on immediately unless you schedule it. Buyers type it in the "Promo code" box in the checkout order summary.',
    tips: [
      'Keep it short and memorable: SUMMER, WELCOME, LOCAL10',
      'One code per store per name — you cannot have two "WELCOME"',
      'Codes are case-insensitive for the buyer',
      'The checkout box shows the buyer whether it worked before they pay',
    ],
  },
  {
    number: 3,
    title: 'Set the window and limits',
    description:
      'Every code has an on/off switch, an optional start and end time, an optional minimum subtotal, and an optional cap on total redemptions. Change any of it whenever you want.',
    tips: [
      'No dates = runs until you switch it off',
      'Start in the future = the code is "Scheduled" and inert until then',
      'Redemption cap = the code turns itself off after N paid orders',
      'The count only moves when an order is actually paid, not when someone types the code',
    ],
  },
  {
    number: 4,
    title: 'Share it deliberately',
    description:
      'A code only helps if the right people see it. Put a public code in your bio or a story; keep a loyalty code to direct messages and your WhatsApp broadcast list.',
    tips: [
      'Public: pin it to a post or add it to your bio',
      'Private: send it in the delivery follow-up message',
      'Always show the buyer the exact code text — no typos',
      'Say when it ends: urgency is half the point',
    ],
  },
  {
    number: 5,
    title: 'Watch how it performs',
    description:
      'The Promo codes page shows each code’s status and how many times it has been redeemed. Use that to decide whether to extend it, raise the cap, or let it expire.',
    tips: [
      'Status tells you at a glance: Active, Scheduled, Expired, Off, or Used up',
      'Lots of redemptions, thin margins? Add a minimum subtotal next time',
      'No redemptions? The code probably was not seen — not that buyers did not want it',
      'Turn a code off the moment the promo is over so no one gets a surprise discount',
    ],
  },
];

export default function GuidePromoCodesPage() {
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
          category="Marketing & Growth"
          title="Running Promo Codes"
          description="A free-delivery code is a small, cheap lever. Here's when to pull it and how to keep it under control."
          readTime="6 min read"
          steps={STEPS}
          relatedGuides={relatedGuides('promo-codes')}
          ctaText="Go to Promo codes"
          ctaHref="/dashboard/discounts"
          extraContent={
            <div className="my-12 rounded-lg bg-accent p-8 text-accent-foreground">
              <div className="flex gap-3">
                <Icon i="lightbulb" size={24} className="flex-shrink-0" />
                <div>
                  <h3 className="mb-2 font-headings text-lg font-bold">The takeaway</h3>
                  <p className="opacity-90">
                    You do not need a discount to sell — most stores launch fine without one. But a
                    single free-delivery code, shared with people who already know you and set to
                    expire, is the lowest-risk way to get the first orders moving.
                  </p>
                </div>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
