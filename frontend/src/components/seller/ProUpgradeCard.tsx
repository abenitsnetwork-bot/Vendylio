import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

// Phase 4a — the standard "this is a Pro feature" card shown on gated
// dashboard pages (Analytics, Team) for a Free store. Mirrors the copy style
// of DiscountManager's inline upgrade prompt.

export function ProUpgradeCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon i="lock" size={16} />
        </span>
        <p className="font-headings text-lg font-bold text-foreground">{title}</p>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{children}</p>
      <Link
        href="/dashboard/billing"
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Upgrade to Pro
        <Icon i="arrow-right" size={15} />
      </Link>
    </div>
  );
}
