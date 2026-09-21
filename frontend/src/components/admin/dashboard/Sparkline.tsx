'use client';

import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { CHART_ACCENT, CHART_INK } from './colors';

/**
 * A tiny axis-less area chart for KPI tiles. No grid, no tooltip, no legend —
 * just the shape of the last N days. Flat/empty series renders a faint baseline.
 *
 * Uses a "basis" spline (rounds off the curve instead of passing exactly
 * through each point) so sparse daily data — mostly zero with one or two
 * days of activity — reads as soft rounded hills instead of sharp spikes,
 * plus a highlighted dot on the most recent day.
 */
export function Sparkline({
  data,
  tone = 'ink',
  height = 40,
}: {
  data: number[];
  tone?: 'ink' | 'accent';
  height?: number;
}) {
  const color = tone === 'accent' ? CHART_ACCENT : CHART_INK;
  const gradientId = `spark-${tone}`;
  const chartData = data.map((v, i) => ({ i, v }));
  const allZero = data.every((v) => v === 0);
  const lastIndex = chartData.length - 1;

  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="65%" stopColor={color} stopOpacity={0.1} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={allZero ? [0, 1] : ['dataMin', 'dataMax']} />
          <Area
            type="basis"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            strokeOpacity={allZero ? 0.25 : 1}
            strokeLinecap="round"
            fill={`url(#${gradientId})`}
            isAnimationActive
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const isLast = !allZero && props.index === lastIndex;
              return (
                <circle
                  key={`spark-dot-${props.index}`}
                  cx={props.cx}
                  cy={props.cy}
                  r={isLast ? 3 : 0}
                  fill={color}
                  stroke="var(--color-card)"
                  strokeWidth={1.5}
                />
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
