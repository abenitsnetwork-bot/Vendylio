import { PublicNavBar } from '@/components/marketing/PublicNavBar';
import { CtaFooter } from '@/components/marketing/CtaFooter';

export function LegalPageLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background font-body">
      <PublicNavBar />
      <div className="px-4 py-12 lg:px-14 lg:py-16">
        <div className="mx-auto max-w-3xl">
          <h1
            className="mb-2 font-headings font-bold text-foreground"
            style={{ fontSize: 'clamp(28px, 5vw, 40px)', letterSpacing: '-1px' }}
          >
            {title}
          </h1>
          <p className="mb-10 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
          <div className="space-y-8 text-base leading-relaxed text-foreground [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-headings [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-foreground [&_p]:text-muted-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul]:text-muted-foreground [&_a]:text-accent [&_a]:underline">
            {children}
          </div>
        </div>
      </div>
      <CtaFooter />
    </div>
  );
}
