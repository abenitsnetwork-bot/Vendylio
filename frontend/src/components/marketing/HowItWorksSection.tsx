import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';

const STEPS: { num: string; icon: IconName; title: string; desc: string }[] = [
  {
    num: '01',
    icon: 'store',
    title: 'Create your store',
    desc: 'Add your products, a photo, a link. Less than 5 minutes.',
  },
  {
    num: '02',
    icon: 'share-2',
    title: 'Share your link',
    desc: 'One unique link to paste in your Instagram bio or WhatsApp group.',
  },
  {
    num: '03',
    icon: 'credit-card',
    title: 'Get paid',
    desc: 'Cash App, Zelle, card — your customer pays however they want.',
  },
  {
    num: '04',
    icon: 'truck',
    title: 'Uber delivers for you',
    desc: 'Activate same-day delivery. Uber Direct takes it from there.',
  },
];

export function HowItWorksSection() {
  return (
    <section
      id="how-it-works"
      className="border-t border-border bg-secondary px-4 py-16 font-body lg:px-14 lg:py-20"
    >
      <div className="mx-auto mb-12 max-w-7xl text-center lg:mb-14">
        <h2
          className="mb-3 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(26px, 4vw, 36px)', letterSpacing: '-0.8px' }}
        >
          How it works
        </h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          From zero to your first delivery in under an hour.
        </p>
        <Link href="/how-it-works" className="mt-3 inline-block text-sm font-medium text-accent">
          See the full walkthrough →
        </Link>
      </div>
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <div key={step.num} className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className="font-headings text-3xl font-bold text-accent">{step.num}</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Icon i={step.icon} size={18} className="text-foreground" />
            </div>
            <p className="font-headings text-base font-semibold text-foreground">{step.title}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
