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
    title: 'Choose Your Payment Methods',
    description:
      'Vendylio pays sellers out via Cash App or Zelle — decide which one you want to use.',
    tips: [
      'Cash App: instant, best for quick access',
      'Zelle: 1-2 days, ties directly to your bank',
      'You can add both and pick per withdrawal',
      'Have your $Cashtag or Zelle contact ready',
    ],
  },
  {
    number: 2,
    title: 'Set a Withdrawal PIN',
    description:
      'The first time you request a withdrawal, Vendylio asks you to set a 4-6 digit PIN to confirm future requests.',
    tips: [
      "You'll be prompted automatically on your first request",
      'Keep it separate from your account password',
      'You can change it anytime from Billing & Payouts',
      "Don't share it — support will never ask for it",
    ],
  },
  {
    number: 3,
    title: 'Request a Withdrawal',
    description:
      'From Billing & Payouts, enter the amount and your Cash App tag or Zelle contact, then confirm with your PIN.',
    tips: [
      'Double-check your $Cashtag or Zelle contact',
      'Requests start as Pending',
      'Vendylio charges 0% on withdrawals',
      "You'll see the request in your history right away",
    ],
  },
  {
    number: 4,
    title: 'Understand Processing',
    description:
      "Vendylio doesn't automate Cash App/Zelle transfers — a real person on the team sends the payment and marks it completed.",
    tips: [
      'Most requests are handled within 1-2 business days',
      'Status updates from Pending → Processing → Completed',
      "Bank-side fees (if any) are outside Vendylio's control",
      'Reach out via Help & Support if a request seems stuck',
    ],
  },
];

const COMPARISON = [
  { method: 'Cash App', speed: 'Instant', fee: '$0', for: 'Quick access' },
  { method: 'Zelle', speed: '1-2 days', fee: '$0-$1*', for: 'Bank transfers' },
];

const FAQ = [
  {
    q: 'How quickly will I receive my money?',
    a: 'Vendylio processes requests manually, typically within 1-2 business days. Cash App transfers from us are usually instant once sent.',
  },
  {
    q: 'Are there any fees for withdrawals?',
    a: 'Vendylio charges 0% withdrawal fees. Your bank may charge a small transfer fee on Zelle in rare cases.',
  },
  {
    q: 'Can I change my payment method later?',
    a: "Yes — you pick Cash App or Zelle each time you request a withdrawal, there's nothing to switch in settings.",
  },
  {
    q: 'What if I make a mistake entering my account info?',
    a: 'Reach out via Help & Support before the request is marked completed and we can correct it.',
  },
];

export default function GuidePaymentSetupPage() {
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
          category="Operations & Money"
          title="Getting Paid"
          description="How money reaches you on Vendylio — card payments and Cash App / Zelle withdrawals."
          readTime="5 min read"
          steps={STEPS}
          relatedGuides={relatedGuides('payment-setup')}
          ctaText="Go to Billing & Payouts"
          ctaHref="/dashboard/billing"
          extraContent={
            <>
              <div className="my-12">
                <h3 className="mb-6 font-headings text-xl font-bold text-foreground">
                  Payment Methods Comparison
                </h3>
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="grid grid-cols-4 gap-0 border-b border-border">
                    {['Method', 'Speed', 'Fee', 'Best For'].map((h) => (
                      <div
                        key={h}
                        className="border-r border-border bg-secondary p-4 text-sm font-semibold text-foreground last:border-r-0"
                      >
                        {h}
                      </div>
                    ))}
                  </div>
                  {COMPARISON.map((row) => (
                    <div
                      key={row.method}
                      className="grid grid-cols-4 gap-0 border-b border-border last:border-b-0"
                    >
                      <div className="border-r border-border p-4 text-sm font-semibold text-foreground">
                        {row.method}
                      </div>
                      <div className="border-r border-border p-4 text-sm text-muted-foreground">
                        {row.speed}
                      </div>
                      <div className="border-r border-border p-4 text-sm text-muted-foreground">
                        {row.fee}
                      </div>
                      <div className="p-4 text-sm text-muted-foreground">{row.for}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  *Vendylio charges 0% — any fee shown is your bank&apos;s, not ours.
                </p>
              </div>

              <div className="mb-12 rounded-lg bg-primary p-8 text-primary-foreground">
                <div className="flex gap-3">
                  <Icon i="shield" size={24} className="flex-shrink-0" />
                  <div>
                    <h3 className="mb-2 font-headings text-lg font-bold">Your Payment Security</h3>
                    <p className="mb-3 opacity-90">
                      Your withdrawal PIN is hashed, never logged in plaintext, and required to
                      confirm every request.
                    </p>
                    <p className="text-sm opacity-85">
                      You can update your Cash App tag or Zelle contact anytime from Billing &
                      Payouts.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-12 border-t border-border pt-12">
                <h3 className="mb-6 font-headings text-xl font-bold text-foreground">
                  Common Questions
                </h3>
                <div className="space-y-4">
                  {FAQ.map((item) => (
                    <div key={item.q} className="rounded-lg border border-border p-4">
                      <p className="mb-2 text-sm font-semibold text-foreground">{item.q}</p>
                      <p className="text-sm text-muted-foreground">{item.a}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          }
        />
      </div>
    </div>
  );
}
