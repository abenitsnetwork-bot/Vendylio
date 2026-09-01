import { Icon, type IconName } from '@/components/ui/Icon';
import { DeltaChip } from './DeltaChip';
import { Sparkline } from './Sparkline';

/**
 * One dashboard counter: thin accent rule, icon, uppercase label, big
 * tabular-nums value, then either a delta chip or a "+N new" note, and an
 * optional sparkline. Subtle hover lift — the only "futuristic" flourish.
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
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card p-4 transition-transform duration-150 hover:-translate-y-0.5">
      <span
        className={`absolute inset-x-0 top-0 h-0.5 ${accent ? 'bg-accent' : 'bg-primary/25'}`}
        aria-hidden="true"
      />
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground">
        <Icon i={icon} size={13} />
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="font-headings text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <div className="mt-1 min-h-[16px]">
        {addedNote != null ? (
          <span className="text-[11px] font-semibold text-green-700">{addedNote}</span>
        ) : deltaPct !== undefined ? (
          <DeltaChip deltaPct={deltaPct} suffix={deltaSuffix} invertTone={invertDelta} />
        ) : null}
      </div>
      {spark && spark.length > 1 && (
        <div className="-mx-1 mt-2">
          <Sparkline data={spark} tone={sparkTone} />
        </div>
      )}
    </div>
  );
}
