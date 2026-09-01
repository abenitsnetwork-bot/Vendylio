import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { CtaFooter } from '@/components/marketing/CtaFooter';
import { BusinessWaitlistForm } from '@/components/marketing/BusinessWaitlistForm';
import { Icon } from '@/components/ui/Icon';

export const metadata: Metadata = {
  title: 'Pricing — Vendylio',
  description:
    'Start free with a 5% card fee, or go Pro for $29/mo and a 1.5% fee plus courier delivery, promo codes, analytics, a custom domain and more.',
};

interface Row {
  label: string;
  free: string | boolean;
  pro: string | boolean;
}

const ROWS: Row[] = [
  { label: 'Transaction fee (card sales)', free: '5%', pro: '1.5%' },
  { label: 'Cash App & Zelle fee', free: '5%', pro: '1.5%' },
  { label: 'Products', free: 'Unlimited', pro: 'Unlimited' },
  { label: 'Storefronts', free: '1', pro: '1' },
  { label: 'Card, Cash App & Zelle checkout', free: true, pro: true },
  { label: 'Pickup & self-delivery', free: true, pro: true },
  { label: 'Inventory & low-stock alerts', free: true, pro: true },
  { label: 'Order tracking & customer emails', free: true, pro: true },
  { label: 'Storefront hero images', free: '1', pro: '3' },
  { label: 'AI product descriptions', free: '5 / month', pro: 'Unlimited' },
  { label: 'Courier delivery (DoorDash / Uber Direct)', free: false, pro: true },
  { label: 'Promo codes', free: false, pro: true },
  { label: 'Advanced analytics', free: false, pro: true },
  { label: 'Custom domain', free: false, pro: true },
  { label: 'Team members', free: false, pro: true },
  { label: 'Remove “Powered by Vendylio”', free: false, pro: true },
  { label: 'Bank / ACH payouts', free: false, pro: true },
  { label: 'Priority support', free: false, pro: true },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true)
    return <Icon i="check" size={16} className="mx-auto text-primary" aria-label="Included" />;
  if (value === false)
    return (
      <Icon
        i="x"
        size={16}
        className="mx-auto text-muted-foreground/50"
        aria-label="Not included"
      />
    );
  return <span className="text-sm text-foreground">{value}</span>;
}

export default function PricingPage() {
  return (
    <div className="bg-background font-body">
      <PublicNavBar />

      <div className="px-4 py-12 lg:px-14 lg:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center lg:mb-14">
            <h1
              className="mb-4 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(30px, 6vw, 46px)', letterSpacing: '-1.2px' }}
            >
              Simple pricing that grows with you
            </h1>
            <p className="mx-auto max-w-xl text-base text-muted-foreground">
              Start free — you only pay when you sell. Move to Pro when a lower fee and the growth
              tools pay for themselves.
            </p>
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-7">
              <p className="font-headings text-lg font-bold text-foreground">Free</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Everything you need to open and run your store.
              </p>
              <p className="mt-5 font-headings text-4xl font-bold text-foreground">
                $0<span className="text-base font-medium text-muted-foreground">/month</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">5% fee on card sales</p>
              <Link
                href="/register"
                className="mt-6 block rounded-full border border-primary px-6 py-3 text-center text-sm font-semibold text-primary hover:bg-secondary"
              >
                Start free
              </Link>
            </div>

            <div className="relative rounded-2xl border-2 border-primary bg-card p-7">
              <span className="absolute -top-3 left-7 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                Most popular
              </span>
              <p className="font-headings text-lg font-bold text-foreground">Pro</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Lower fees plus the tools to grow — delivery, promos, analytics.
              </p>
              <p className="mt-5 font-headings text-4xl font-bold text-foreground">
                $29<span className="text-base font-medium text-muted-foreground">/month</span>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                1.5% fee on card sales · $290/year saves two months
              </p>
              <Link
                href="/register?plan=pro"
                className="mt-6 block rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Start with Pro
              </Link>
            </div>
          </div>

          {/* Break-even note */}
          <p className="mx-auto mt-5 max-w-xl text-center text-xs text-muted-foreground">
            Pro pays for itself at about $830/month in card sales — above that, the lower fee alone
            covers the subscription and every Pro feature is a bonus.
          </p>

          {/* Comparison table */}
          <div className="mt-12 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 pr-4 text-sm font-semibold text-foreground">Feature</th>
                  <th className="w-28 py-3 text-center text-sm font-semibold text-foreground">
                    Free
                  </th>
                  <th className="w-28 py-3 text-center text-sm font-semibold text-primary">Pro</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-border/60">
                    <td className="py-3 pr-4 text-sm text-muted-foreground">{row.label}</td>
                    <td className="py-3 text-center">
                      <Cell value={row.free} />
                    </td>
                    <td className="py-3 text-center">
                      <Cell value={row.pro} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Business teaser */}
          <div className="mt-10 rounded-2xl border border-dashed border-border bg-secondary/40 p-6 text-center">
            <p className="font-headings text-base font-bold text-foreground">
              Business <span className="text-muted-foreground">— coming soon</span>
            </p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              For high-volume sellers: the lowest fees, multiple storefronts, API access, and
              dedicated onboarding.
            </p>
            <BusinessWaitlistForm />
          </div>

          {/* Fee FAQ */}
          <div className="mt-12 border-t border-border pt-10">
            <h2
              className="mb-4 font-headings font-bold text-foreground"
              style={{ fontSize: '22px', letterSpacing: '-0.6px' }}
            >
              How the fee works
            </h2>
            <ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>
                The transaction fee applies to <strong className="text-foreground">card</strong>{' '}
                sales and is deducted automatically. Payment processing (Stripe&apos;s ~2.9% + 30¢)
                is separate and set by Stripe.
              </li>
              <li>
                <strong className="text-foreground">Cash App and Zelle</strong> payments go straight
                to you — Vendylio never handles that money. The same marketplace fee applies (you
                confirm the payment on the order); it&apos;s withheld from your next withdrawal, or
                billed to your card on file if you have no balance to withhold from.
              </li>
              <li>There are no withdrawal fees, setup fees, or contracts. Cancel Pro anytime.</li>
            </ul>
          </div>
        </div>
      </div>

      <CtaFooter />
    </div>
  );
}
