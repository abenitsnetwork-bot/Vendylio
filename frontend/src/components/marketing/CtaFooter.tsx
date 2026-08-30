import Link from 'next/link';

export function CtaFooter() {
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
            Free. No subscription. Ready in 5 minutes. Your community is waiting.
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
          <img src="/logo.png" alt="Vendylio" className="h-7 w-auto" />
          <p className="mt-2 text-xs text-muted-foreground">© 2026 Vendylio · Maryland, USA</p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
          <Link href="/refund-policy" className="hover:text-foreground">
            Refund Policy
          </Link>
          <a href="mailto:no-reply@vendylio.com" className="hover:text-foreground">
            Contact
          </a>
          <span>Instagram</span>
        </div>
      </footer>
    </>
  );
}
