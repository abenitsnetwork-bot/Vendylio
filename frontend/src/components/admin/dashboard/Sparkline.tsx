'use client';

import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { CHART_ACCENT, CHART_INK } from './colors';

/**
 * A tiny axis-less area chart for KPI tiles. No grid, no tooltip, no legend —
 * just the shape of the last N days. Flat/empty series renders a faint baseline.
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

  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={allZero ? [0, 1] : ['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            strokeOpacity={allZero ? 0.25 : 1}
            fill={`url(#${gradientId})`}
            isAnimationActive
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
