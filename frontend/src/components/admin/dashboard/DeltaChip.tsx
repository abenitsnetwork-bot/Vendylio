import { Icon } from '@/components/ui/Icon';

/**
 * "▲ 9.1% / period" style delta pill. Renders nothing when `deltaPct` is null
 * (no prior-period baseline). `invertTone` flips the colour semantics for
 * metrics where "up" is bad (e.g. failed payments).
 */
export function DeltaChip({
  deltaPct,
  suffix = '30d',
  invertTone = false,
}: {
  deltaPct: number | null;
  suffix?: string;
  invertTone?: boolean;
}) {
  if (deltaPct === null || Number.isNaN(deltaPct)) {
    return <span className="text-[11px] text-muted-foreground">— vs prev {suffix}</span>;
  }

  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  const good = flat ? null : invertTone ? !up : up;

  const tone = good === null ? 'text-muted-foreground' : good ? 'text-green-700' : 'text-red-600';

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums ${tone}`}
    >
      {!flat && <Icon i={up ? 'arrow-up' : 'arrow-down'} size={11} />}
      {up ? '+' : ''}
      {deltaPct}% <span className="font-normal text-muted-foreground">/ {suffix}</span>
    </span>
  );
}
