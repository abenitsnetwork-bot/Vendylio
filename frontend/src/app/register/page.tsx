import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { RegistrationForm } from '@/components/auth/RegistrationForm';
import { Icon, type IconName } from '@/components/ui/Icon';

const BENEFITS: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: 'check',
    title: 'Zero Commission',
    desc: 'No monthly fee. Pay nothing. Keep 100% of what you earn.',
  },
  {
    icon: 'truck',
    title: 'Same-Day Delivery',
    desc: 'Powered by Uber Direct. Orders delivered in hours, not days.',
  },
  {
    icon: 'smartphone',
    title: 'Mobile-First',
    desc: 'Manage your store from your phone. Built for busy entrepreneurs.',
  },
  {
    icon: 'shield',
    title: 'Secure Payments',
    desc: 'Cash App, Zelle, card — safe, secure, and familiar.',
  },
];

const REGIONS = ['Maryland', 'Texas', 'California', 'Minnesota'];

export default function RegisterPage() {
  return (
    <div className="bg-background font-body">
      <PublicNavBar />
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-10 px-4 py-10 lg:grid-cols-2 lg:gap-12 lg:px-14 lg:py-16">
        {/* Form */}
        <div className="flex flex-col justify-center">
          <div className="mb-8">
            <h1
              className="mb-2 font-headings font-bold text-foreground"
              style={{ fontSize: 'clamp(28px, 5vw, 36px)', letterSpacing: '-0.8px' }}
            >
              Create your account
            </h1>
            <p className="text-base text-muted-foreground">
              Join 1,200+ sellers in the African diaspora. Open your store in 5 minutes.
            </p>
          </div>
          <RegistrationForm />
        </div>

        {/* Benefits */}
        <div className="flex flex-col justify-between gap-8 rounded-lg border border-border bg-secondary p-6 lg:p-10">
          <div className="space-y-6 lg:space-y-8">
            <h3 className="font-headings text-lg font-bold text-foreground">Why join Vendylio?</h3>
            <div className="space-y-6">
              {BENEFITS.map((b) => (
                <div key={b.title} className="flex gap-4">
                  <div className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary">
                    <Icon i={b.icon} size={18} className="text-primary-foreground" />
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-semibold text-foreground">{b.title}</p>
                    <p className="text-sm text-muted-foreground">{b.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
              Trusted by sellers in
            </p>
            <div className="flex flex-wrap gap-4">
              {REGIONS.map((r) => (
                <div
                  key={r}
                  className="rounded bg-card px-3 py-1 text-xs font-semibold text-foreground"
                >
                  {r}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
