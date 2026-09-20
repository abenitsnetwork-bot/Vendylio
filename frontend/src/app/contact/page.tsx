import type { Metadata } from 'next';
import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { CtaFooter } from '@/components/marketing/CtaFooter';
import { ContactForm } from '@/components/marketing/ContactForm';
import { Icon, type IconName } from '@/components/ui/Icon';

export const metadata: Metadata = {
  title: 'Contact — Vendylio',
  description: 'Questions about selling on Vendylio, billing, or press? Reach out — we reply fast.',
};

const INFO: { icon: IconName; label: string; value: string }[] = [
  { icon: 'mail', label: 'Email', value: 'no-reply@vendylio.com' },
  { icon: 'clock', label: 'Response time', value: 'Usually within a business day' },
  { icon: 'map-pin', label: 'Based in', value: 'Maryland, USA' },
];

export default function ContactPage() {
  return (
    <div className="bg-background font-body">
      <PublicNavBar />
      <div className="px-4 py-12 lg:px-14 lg:py-16">
        <div className="mx-auto mb-12 max-w-5xl lg:mb-16">
          <h1
            className="mb-4 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(32px, 6vw, 48px)', letterSpacing: '-1.5px' }}
          >
            Get in touch
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            Question about opening a store, a Pro feature, or press? Send us a message and a real
            person will get back to you.
          </p>
        </div>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,280px)_1fr] lg:gap-16">
          <div className="space-y-6">
            {INFO.map((item) => (
              <div key={item.label} className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-secondary">
                  <Icon i={item.icon} size={18} className="text-accent" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="text-sm text-foreground">{item.value}</p>
                </div>
              </div>
            ))}
          </div>

          <ContactForm />
        </div>
      </div>
      <CtaFooter />
    </div>
  );
}
