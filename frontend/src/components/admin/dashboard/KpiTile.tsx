import { Icon, type IconName } from '@/components/ui/Icon';
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
  accent?: boolean;
  compact?: boolean;
  valueTone?: 'default' | 'positive';
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-lg border border-border bg-card transition-transform duration-150 hover:-translate-y-0.5 ${
        compact ? 'p-3.5' : 'p-4'
      }`}
    >
      <span
        className={`absolute inset-x-0 top-0 h-0.5 ${accent ? 'bg-accent' : 'bg-primary/25'}`}
        aria-hidden="true"
      />
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${
            accent ? 'bg-accent/10 text-accent' : 'bg-primary/10 text-primary'
          }`}
        >
          <Icon i={icon} size={13} />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <p
        className={`font-headings font-bold tabular-nums ${compact ? 'text-xl' : 'text-2xl'} ${
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
