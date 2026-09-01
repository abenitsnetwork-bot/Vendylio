'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { SLICE_COLORS, TOOLTIP_STYLE } from './colors';

export interface BreakdownRow {
  label: string;
  valueCents: number;
}

/**
 * Donut + a money/percent legend list (the Octoboard "breakdown" pattern).
 * Each legend row: colour dot, label, $value, % of total. Empty → a placeholder.
 */
export function BreakdownDonut({
  rows,
  formatMoney,
  emptyLabel = 'No paid orders yet.',
}: {
  rows: BreakdownRow[];
  formatMoney: (cents: number) => string;
  emptyLabel?: string;
}) {
  const total = rows.reduce((sum, r) => sum + r.valueCents, 0);

  if (rows.length === 0 || total === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const sorted = [...rows].sort((a, b) => b.valueCents - a.valueCents);

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-[200px] w-[200px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={sorted}
              dataKey="valueCents"
              nameKey="label"
              innerRadius={58}
              outerRadius={90}
              paddingAngle={2}
              strokeWidth={0}
            >
              {sorted.map((row, i) => (
                <Cell key={row.label} fill={SLICE_COLORS[i % SLICE_COLORS.length] ?? '#9c8b6f'} />
              ))}
            </Pie>
            <Tooltip
              formatter={(v, name) => [formatMoney(Number(v)), String(name)]}
              contentStyle={TOOLTIP_STYLE}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-2">
        {sorted.map((row, i) => {
          const pct = Math.round((row.valueCents / total) * 100);
          return (
            <li key={row.label} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] ?? '#9c8b6f' }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate text-foreground">{row.label}</span>
              <span className="flex-shrink-0 font-semibold tabular-nums text-foreground">
                {formatMoney(row.valueCents)}
              </span>
              <span className="w-9 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
