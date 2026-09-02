import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

// Landing-page pricing teaser — the two live plans (Free / Pro) side by side.
// Vivid on-brand gradients (coral accent + forest teal). The full comparison
// table + FAQ lives at /pricing.

interface Plan {
  badge: string;
  gradient: string;
  price: string;
  cadence: string;
  blurb: string;
  cta: string;
  href: string;
  featured?: boolean;
  points: string[];
}

const PLANS: Plan[] = [
  {
    badge: 'FREE',
    gradient: 'linear-gradient(135deg, #0f9d8f 0%, #1fbf6b 55%, #46d17a 100%)',
    price: '$0',
    cadence: 'forever',
    blurb: 'Everything you need to launch and take your first orders.',
    cta: 'Start free',
    href: '/register',
    points: [
      '5% fee on every sale',
      'Card, Cash App & Zelle checkout',
      'Pickup, self-delivery & courier delivery',
      'Inventory, order tracking & customer emails',
      '1 hero image · 5 AI descriptions / month',
    ],
  },
  {
    badge: 'PRO',
    gradient: 'linear-gradient(135deg, #dd5b2e 0%, #e0417a 55%, #d6409a 100%)',
    price: '$29',
    cadence: '/ month · or $290 / year',
    blurb: 'Lower fees and the tools to grow once orders pick up.',
    cta: 'Go Pro',
    href: '/register',
    featured: true,
    points: [
      'Everything in Free, plus:',
      '1.5% fee on every sale',
      'Promo codes & advanced storefront analytics',
      'Custom domain & team members',
      'Bank (ACH) payouts + higher withdrawal limits',
      'Unlimited AI · 3 hero images · no Vendylio badge',
    ],
  },
];

export function PlansSection() {
  return (
    <section
      id="plans"
      className="border-t border-border bg-secondary px-4 py-16 font-body lg:px-14 lg:py-20"
    >
      <div className="mx-auto mb-10 max-w-7xl text-center lg:mb-14">
        <h2
          className="mb-3 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(26px, 4vw, 36px)', letterSpacing: '-0.8px' }}
        >
          One simple choice
        </h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Start free with a 5% fee. Move to Pro for a 1.5% fee plus the growth tools — whenever your
          sales make it worth it.
        </p>
      </div>

      <div className="mx-auto grid max-w-4xl grid-cols-1 items-start gap-6 md:grid-cols-2">
        {PLANS.map((plan) => (
          <div
            key={plan.badge}
            className={`relative overflow-hidden rounded-2xl border bg-card shadow-sm ${
              plan.featured ? 'border-accent/40 shadow-lg md:-mt-3' : 'border-border'
            }`}
          >
            {plan.featured && (
              <span className="absolute right-4 top-4 z-10 rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">
                Most popular
              </span>
            )}

            {/* Gradient header */}
            <div
              className="relative px-6 pb-8 pt-6 text-white"
              style={{ background: plan.gradient }}
            >
              <span className="inline-block rounded-full border border-white/40 px-3 py-1 text-xs font-bold uppercase tracking-widest">
                {plan.badge}
              </span>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-headings text-5xl font-bold">{plan.price}</span>
                <span className="text-sm font-medium text-white/90">{plan.cadence}</span>
              </div>
              <p className="mt-2 max-w-xs text-sm text-white/90">{plan.blurb}</p>
              {/* Decorative blob */}
              <div className="pointer-events-none absolute -bottom-16 -right-10 h-40 w-40 rounded-full bg-white/10" />
            </div>

            <div className="p-6">
              <ul className="space-y-3">
                {plan.points.map((point, i) => (
                  <li key={point} className="flex gap-2.5 text-sm text-foreground">
                    {i === 0 && plan.featured ? (
                      <span className="font-semibold">{point}</span>
                    ) : (
                      <>
                        <Icon i="check-circle" size={18} className="mt-0.5 shrink-0 text-accent" />
                        <span>{point}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.href}
                className={`mt-6 block rounded-full px-5 py-3 text-center text-sm font-semibold transition hover:opacity-90 ${
                  plan.featured
                    ? 'bg-accent text-accent-foreground'
                    : 'border border-border bg-card text-foreground hover:bg-secondary'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          </div>
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-md text-center text-sm text-muted-foreground">
        No card to start. Cancel Pro anytime.{' '}
        <Link href="/pricing" className="font-medium text-accent hover:underline">
          See the full comparison →
        </Link>
      </p>
    </section>
  );
}
