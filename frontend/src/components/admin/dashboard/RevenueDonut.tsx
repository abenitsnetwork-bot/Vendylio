'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { METHOD_COLORS, SLICE_COLORS, TOOLTIP_STYLE } from './colors';

export interface RevenueSlice {
  label: string;
  valueCents: number;
  /** Secondary figure shown under the legend row, e.g. "12 orders". */
  note?: string;
}

/** Colour for a slice — a fixed payment-method colour if we know it, else the palette. */
function sliceColor(label: string, i: number): string {
  return METHOD_COLORS[label] ?? SLICE_COLORS[i % SLICE_COLORS.length] ?? '#9c8b6f';
}

/**
 * The Octoboard "sales overview" centrepiece: a ring with the running total in
 * the middle and a money / percent legend beneath it. Used for the "Sales
 * revenue" breakdown (GMV by payment method) on the admin dashboard.
 */
export function RevenueDonut({
  slices,
  centerValue,
  centerLabel = 'total',
  formatMoney,
  emptyLabel = 'No paid orders in this period.',
}: {
  slices: RevenueSlice[];
  centerValue: string;
  centerLabel?: string;
  formatMoney: (cents: number) => string;
  emptyLabel?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.valueCents, 0);
  const sorted = [...slices].sort((a, b) => b.valueCents - a.valueCents);

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[190px] w-[190px]">
        {total > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={sorted}
                dataKey="valueCents"
                nameKey="label"
                innerRadius={62}
                outerRadius={92}
                paddingAngle={sorted.length > 1 ? 2 : 0}
                strokeWidth={0}
                startAngle={90}
                endAngle={-270}
              >
                {sorted.map((s, i) => (
                  <Cell key={s.label} fill={sliceColor(s.label, i)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v, name) => [formatMoney(Number(v)), String(name)]}
                contentStyle={TOOLTIP_STYLE}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="h-full w-full rounded-full border-[18px] border-border"
            aria-hidden="true"
          />
        )}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {centerLabel}
          </span>
          <span className="font-headings text-xl font-bold tabular-nums text-foreground">
            {centerValue}
          </span>
        </div>
      </div>

      {total === 0 ? (
        <p className="mt-4 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-4 w-full space-y-2">
          {sorted.map((s, i) => {
            const pct = Math.round((s.valueCents / total) * 100);
            return (
              <li key={s.label} className="flex items-center gap-2.5 text-sm">
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: sliceColor(s.label, i) }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {s.label}
                  {s.note && (
                    <span className="ml-1.5 text-xs text-muted-foreground">· {s.note}</span>
                  )}
                </span>
                <span className="flex-shrink-0 font-semibold tabular-nums text-foreground">
                  {formatMoney(s.valueCents)}
                </span>
                <span className="w-9 flex-shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
