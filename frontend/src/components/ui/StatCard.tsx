import type { ReactNode } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

// One of the --color-stat-* tokens (globals.css) — dashboard-only vivid
// accents, kept separate from the brand --color-accent (coral) so a row of
// stat cards reads as colorful without touching the site's CTA color.
export type StatAccent = 'indigo' | 'emerald' | 'amber' | 'rose' | 'sky' | 'violet';

const ACCENT_VAR: Record<StatAccent, string> = {
  indigo: 'var(--color-stat-indigo)',
  emerald: 'var(--color-stat-emerald)',
  amber: 'var(--color-stat-amber)',
  rose: 'var(--color-stat-rose)',
  sky: 'var(--color-stat-sky)',
  violet: 'var(--color-stat-violet)',
};

export interface StatCardProps {
  icon: IconName;
  accent: StatAccent;
  label: string;
  value: string | number;
  /** A string gets the tone classes below; pass your own element for
   * multi-branch/multi-color messages (the tone classes are skipped). */
  sub?: ReactNode;
  subTone?: 'muted' | 'warn' | 'accent';
  /** Period-over-period % change — renders a small up/down badge next to
   * the value (same convention as the former analytics-only DeltaBadge).
   * `null`/omitted renders nothing (not enough data for a comparison). */
  delta?: number | null;
  /** Wraps the card in a Link when set (matches the existing "Pending Orders" /
   * "Active Products" clickable-tile convention). */
  href?: string;
  className?: string;
}

function DeltaBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
      style={{
        color: up ? 'var(--chart-positive)' : 'var(--chart-negative)',
        backgroundColor: up ? 'rgba(21,128,61,0.10)' : 'rgba(185,28,28,0.10)',
      }}
    >
      <Icon i={up ? 'arrow-up' : 'arrow-down'} size={11} />
      {Math.abs(pct)}%
    </span>
  );
}

// Shared stat tile: icon badge (soft tint of `accent` behind a solid icon) +
// label + big value + optional sub-line/delta. Replaces the ad-hoc
// "label + font-headings number" markup previously duplicated on every
// dashboard page.
export function StatCard({
  icon,
  accent,
  label,
  value,
  sub,
  subTone = 'muted',
  delta,
  href,
  className,
}: StatCardProps) {
  const color = ACCENT_VAR[accent];
  const body = (
    <Card
      className={cn(
        'flex flex-col gap-3',
        href && 'transition-colors hover:border-accent',
        className,
      )}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
      >
        <Icon i={icon} size={18} />
      </span>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <p className="font-headings text-2xl font-bold text-foreground">{value}</p>
          {delta != null && <DeltaBadge pct={delta} />}
        </div>
        {sub && (
          <p
            className={cn(
              'mt-1 text-xs',
              subTone === 'warn' && 'font-semibold text-amber-600',
              subTone === 'accent' && 'font-semibold text-accent',
              subTone === 'muted' && 'text-muted-foreground',
            )}
          >
            {sub}
          </p>
        )}
      </div>
    </Card>
  );

  return href ? <Link href={href}>{body}</Link> : body;
}
