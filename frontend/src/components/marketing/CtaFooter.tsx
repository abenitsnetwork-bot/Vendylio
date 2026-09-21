import Link from 'next/link';
import { getSiteSettings } from '@/lib/server/siteSettings';

const SOCIAL_LABELS = {
  instagramUrl: 'Instagram',
  facebookUrl: 'Facebook',
  twitterUrl: 'X',
  tiktokUrl: 'TikTok',
  linkedinUrl: 'LinkedIn',
} as const;

export async function CtaFooter() {
  const settings = await getSiteSettings();
  const socials = (Object.keys(SOCIAL_LABELS) as (keyof typeof SOCIAL_LABELS)[])
    .map((key) => ({ label: SOCIAL_LABELS[key] as string, url: settings[key] }))
    .filter((s): s is { label: string; url: string } => Boolean(s.url));

  return (
    <>
      <section className="flex flex-col items-start gap-6 bg-panel px-4 py-12 font-body lg:flex-row lg:items-center lg:justify-between lg:px-14 lg:py-16">
        <div className="mx-auto max-w-7xl">
          <h2
            className="mb-2 font-headings font-bold leading-tight text-panel-foreground"
            style={{ fontSize: 'clamp(26px, 4vw, 36px)', letterSpacing: '-0.8px' }}
          >
            Ready to open your store?
          </h2>
          <p className="max-w-md text-sm font-body leading-relaxed text-panel-foreground/80">
            Start free. No card required. Ready in 5 minutes. Your community is waiting.
          </p>
        </div>
        <div className="flex w-full flex-col items-start gap-2 lg:w-auto lg:items-end">
          <Link
            href="/register"
            className="w-full rounded-full bg-accent px-8 py-3.5 text-center text-sm font-semibold text-accent-foreground hover:opacity-90 lg:w-auto"
          >
            Open My Store — It&apos;s Free
          </Link>
          <p className="text-xs text-panel-foreground/60">No credit card required</p>
        </div>
      </section>

      <footer className="flex flex-col items-start gap-6 border-t border-border bg-card px-4 py-8 font-body lg:flex-row lg:items-center lg:justify-between lg:px-14">
        <div>
          <img src="/logo.png" alt="Vendylio" className="h-9 w-auto" />
          <p className="mt-2 text-xs text-muted-foreground">From your hands to their doorstep.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            © 2026 Vendylio · {settings.location}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/refund-policy" className="hover:text-foreground">
            Refund Policy
          </Link>
          <Link href="/contact" className="hover:text-foreground">
            Contact
          </Link>
          {socials.map((s) => (
            <a
              key={s.label}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
            >
              {s.label}
            </a>
          ))}
        </div>
      </footer>
    </>
  );
}
