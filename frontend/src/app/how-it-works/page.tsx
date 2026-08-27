import Link from 'next/link';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { CtaFooter } from '@/components/marketing/CtaFooter';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { type IconName } from '@/components/ui/Icon';

const STEPS: { num: string; title: string; desc: string; icon: IconName }[] = [
  {
    num: '01',
    title: 'Create Your Store',
    desc: 'Add your store name, description, and upload a logo. Take a photo of your products — just keep it simple. Our builder handles the rest.',
    icon: 'smartphone',
  },
  {
    num: '02',
    title: 'Add Your Products',
    desc: 'List what you sell: prices, descriptions, quantities. Photos optional — text works too. You can update anytime.',
    icon: 'package',
  },
  {
    num: '03',
    title: 'Share Your Link',
    desc: 'Get one unique link. Paste it in your Instagram bio, WhatsApp status, or any group. No app needed — your customers just click.',
    icon: 'share-2',
  },
  {
    num: '04',
    title: 'Receive Orders',
    desc: 'Customers order and pay directly. You see every order in your dashboard in real-time. Cash App, Zelle, card — your choice.',
    icon: 'inbox',
  },
  {
    num: '05',
    title: 'Enable Same-Day Delivery',
    desc: 'Activate Uber Direct for your area. Orders get picked up and delivered the same day. Uber handles the logistics.',
    icon: 'truck',
  },
  {
    num: '06',
    title: 'Get Paid',
    desc: 'Earnings land in your Cash App or Zelle. Zero hidden fees. You keep what you earn.',
    icon: 'dollar-sign',
  },
];

export default function HowItWorksDetailPage() {
  return (
    <div className="bg-background font-body">
      <PublicNavBar />
      <div className="px-4 py-12 lg:px-14 lg:py-16">
        <div className="mx-auto mb-16 max-w-5xl">
          <h1
            className="mb-4 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(32px, 6vw, 48px)', letterSpacing: '-1.5px' }}
          >
            How it works — step by step
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            From zero to your first delivery in under an hour. Here&apos;s the full walkthrough.
          </p>
        </div>

        <div className="mx-auto max-w-5xl space-y-16 lg:space-y-20">
          {STEPS.map((step, i) => (
            <div
              key={step.num}
              className="grid grid-cols-1 items-center gap-6 lg:grid-cols-2 lg:gap-12"
            >
              <div className={i % 2 === 1 ? 'lg:order-2' : 'lg:order-1'}>
                <div className="mb-6 flex items-end gap-3">
                  <span
                    className="font-headings font-bold text-primary"
                    style={{ fontSize: '48px', letterSpacing: '-2px' }}
                  >
                    {step.num}
                  </span>
                  <div className="mb-4 h-0.5 flex-1 bg-primary" />
                </div>
                <h2
                  className="mb-3 font-headings font-bold text-foreground"
                  style={{ fontSize: '26px', letterSpacing: '-0.8px' }}
                >
                  {step.title}
                </h2>
                <p className="max-w-sm text-base leading-relaxed text-muted-foreground">
                  {step.desc}
                </p>
              </div>

              <div className={i % 2 === 1 ? 'lg:order-1' : 'lg:order-2'}>
                <ImagePlaceholder
                  icon={step.icon}
                  className="aspect-[16/10] w-full rounded-lg border border-border shadow-sm"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-5xl border-t border-border pt-12 text-center lg:mt-20">
          <h3
            className="mb-4 font-headings font-bold text-foreground"
            style={{ fontSize: '28px', letterSpacing: '-0.8px' }}
          >
            Ready to start selling?
          </h3>
          <p className="mx-auto mb-8 max-w-sm text-base text-muted-foreground">
            It really does take just 5 minutes. No credit card needed.
          </p>
          <Link
            href="/register"
            className="inline-block rounded-lg bg-primary px-8 py-4 text-base font-semibold text-primary-foreground"
          >
            Open My Store Now
          </Link>
        </div>
      </div>
      <CtaFooter />
    </div>
  );
}
