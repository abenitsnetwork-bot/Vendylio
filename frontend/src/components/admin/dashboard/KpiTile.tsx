import { Icon, type IconName } from '@/components/ui/Icon';
import type { StatAccent } from '@/components/ui/StatCard';
import { DeltaChip } from './DeltaChip';
import { Sparkline } from './Sparkline';

/**
 * One dashboard counter: a thin accent rule, a tinted icon badge, an uppercase
 * label, a big tabular-nums value, then either a delta chip or a "+N new" note,
 * and an optional sparkline. Subtle hover lift — the only "futuristic" flourish.
 *
 * `compact` tightens the padding and shrinks the sparkline for the stacked
 * column next to the revenue donut; `valueTone="positive"` prints the value in
 * green (the Octoboard treatment for money KPIs).
 *
 * `accent` is `true` for the plain brand-coral badge (unchanged), a
 * --color-stat-* name (see StatCard) for one of the seller-dashboard's vivid
 * badge colors, or `false`/omitted for the neutral gray badge.
 */
export function KpiTile({
  label,
  icon,
  value,
  deltaPct,
  deltaSuffix = '30d',
  invertDelta = false,
  addedNote,
  spark,
  sparkTone = 'ink',
  accent = false,
  compact = false,
  valueTone = 'default',
}: {
  label: string;
  icon: IconName;
  value: string;
  deltaPct?: number | null | undefined;
  deltaSuffix?: string;
  invertDelta?: boolean;
  addedNote?: string | undefined;
  spark?: number[] | undefined;
  sparkTone?: 'ink' | 'accent';
  accent?: boolean | StatAccent;
  compact?: boolean;
  valueTone?: 'default' | 'positive';
}) {
  const badgeColor =
    typeof accent === 'string'
      ? `var(--color-stat-${accent})`
      : accent
        ? 'var(--color-accent)'
        : null;

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md ${
        compact ? 'p-4' : 'p-5'
      }`}
    >
      <span
        className={`absolute inset-x-0 top-0 h-0.5 ${badgeColor ? '' : 'bg-primary/25'}`}
        style={badgeColor ? { backgroundColor: badgeColor } : undefined}
        aria-hidden="true"
      />
      <div className={`flex items-center gap-2.5 ${compact ? 'mb-2.5' : 'mb-3'}`}>
        <span
          className={`flex flex-shrink-0 items-center justify-center rounded-full ${
            compact ? 'h-8 w-8' : 'h-9 w-9'
          } ${badgeColor ? '' : 'bg-secondary text-muted-foreground'}`}
          style={
            badgeColor
              ? {
                  backgroundColor: `color-mix(in srgb, ${badgeColor} 16%, transparent)`,
                  color: badgeColor,
                }
              : undefined
          }
        >
          <Icon i={icon} size={compact ? 15 : 17} />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p
        className={`font-headings font-bold tabular-nums ${compact ? 'text-2xl' : 'text-3xl'} ${
          valueTone === 'positive' ? 'text-green-700' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      <div className="mt-1 min-h-[16px]">
        {addedNote != null ? (
          <span className="text-[11px] font-semibold text-green-700">{addedNote}</span>
        ) : deltaPct !== undefined ? (
          <DeltaChip deltaPct={deltaPct} suffix={deltaSuffix} invertTone={invertDelta} />
        ) : null}
      </div>
      {spark && spark.length > 1 && (
        <div className="-mx-1 mt-2">
          <Sparkline data={spark} tone={sparkTone} height={compact ? 28 : 40} />
        </div>
      )}
    </div>
  );
}
