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
    title: 'Find your one link',
    description:
      'Every Vendylio store has a single link — vendylio.com/s/your-store — that never changes. It is on your dashboard and in Settings, with a "Share" button that copies it for you.',
    tips: [
      'One link for everything: bio, posts, DMs, print',
      'It stays the same forever, so reuse it everywhere',
      'The Share button has one-tap WhatsApp and email, and copy for Instagram / TikTok',
      'Test it in a private tab to see what buyers see',
    ],
  },
  {
    number: 2,
    title: 'Put it in every bio',
    description:
      'Your Instagram, TikTok and Facebook bio link is the highest-value slot you own. Point it straight at your store, not a link-in-bio page with ten other things.',
    tips: [
      'Instagram: Edit profile → Links → add the URL',
      'TikTok: only available once you have the website field — use it',
      'Add a short call to action: "Order here 👇"',
      'Pin a post that explains what you sell and how delivery works',
    ],
  },
  {
    number: 3,
    title: 'Use WhatsApp status and broadcast',
    description:
      'For local sellers, WhatsApp converts better than any feed. Post your link to your status when you restock, and keep a broadcast list of past buyers.',
    tips: [
      'Status: a clear product photo + the link + price',
      'Broadcast lists send one message privately to many contacts',
      'Never add people to a group without asking — use broadcast',
      'Re-post status a few times a week; it disappears after 24h',
    ],
  },
  {
    number: 4,
    title: 'Make posts that carry the link',
    description:
      'Any post about a product should tell people exactly how to buy. Assume the viewer has never heard of Vendylio.',
    tips: [
      '"Tap the link in my bio to order" on every product post',
      'Show the unboxing / the product in use, not just a flat photo',
      'Stories: use the link sticker so it is one tap',
      'Repost customer photos (with permission) as proof',
    ],
  },
  {
    number: 5,
    title: 'Ask directly for the first orders',
    description:
      'Your first ten orders usually come from people who already know you. Message them personally — a broadcast to your contacts, a note to family and friends.',
    tips: [
      'A short personal message beats a public post for order #1',
      'Offer a launch promo code (free delivery) to remove friction',
      'Ask happy buyers to share your link with one friend',
      'Every delivered order can leave a review — those build trust',
    ],
  },
];

export default function GuideSharingYourStorePage() {
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
          title="Sharing Your Store"
          description="You have one link that never changes. This is where to put it and how to turn views into the first orders."
          readTime="7 min read"
          steps={STEPS}
          relatedGuides={relatedGuides('sharing-your-store')}
          ctaText="Open store settings"
          ctaHref="/dashboard/settings"
          extraContent={
            <div className="my-12 rounded-lg border border-border p-8">
              <h3 className="mb-4 flex items-center gap-2 font-headings text-lg font-bold text-foreground">
                <Icon i="alert-circle" size={20} className="text-accent" />
                Common mistakes
              </h3>
              <ul className="space-y-3">
                {[
                  'Sharing the link before the store is launched — check it shows the storefront, not "not found".',
                  'Burying the store link under a generic link-in-bio page with many other links.',
                  'Posting products with no instruction on how to actually order.',
                  'Adding contacts to a WhatsApp group without asking — use a broadcast list.',
                ].map((m) => (
                  <li key={m} className="flex gap-3">
                    <span className="text-lg font-bold text-accent">✕</span>
                    <span className="text-muted-foreground">{m}</span>
                  </li>
                ))}
              </ul>
            </div>
          }
        />
      </div>
    </div>
  );
}
