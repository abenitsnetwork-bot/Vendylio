'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_ACCENT, CHART_AXIS, CHART_GRID, CHART_INK, TOOLTIP_STYLE } from './colors';

export interface TrendPoint {
  label: string;
  gmvCents: number;
  orderCount: number;
}

/**
 * GMV bars + an order-count line on a second axis — the Octoboard
 * "sales overview" combo. Fed either the 30-day daily series or the 6-month
 * monthly series.
 */
export function TrendComboChart({
  data,
  formatMoney,
  height = 280,
}: {
  data: TrendPoint[];
  formatMoney: (cents: number) => string;
  height?: number;
}) {
  const lastIndex = data.length - 1;

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="trend-gmv-bar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_INK} stopOpacity={0.9} />
              <stop offset="100%" stopColor={CHART_INK} stopOpacity={0.45} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: CHART_AXIS }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            yAxisId="money"
            tick={{ fontSize: 11, fill: CHART_AXIS }}
            tickFormatter={(v: number) => formatMoney(v)}
            width={70}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fontSize: 11, fill: CHART_AXIS }}
            allowDecimals={false}
            width={32}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) =>
              name === 'GMV' ? [formatMoney(Number(value)), 'GMV'] : [String(value), 'Orders']
            }
          />
          <Bar
            yAxisId="money"
            dataKey="gmvCents"
            name="GMV"
            fill="url(#trend-gmv-bar)"
            radius={[6, 6, 0, 0]}
            maxBarSize={26}
          />
          <Line
            yAxisId="count"
            type="natural"
            dataKey="orderCount"
            name="Orders"
            stroke={CHART_ACCENT}
            strokeWidth={2.5}
            dot={(props: { cx?: number; cy?: number; index?: number }) => (
              <circle
                key={`trend-dot-${props.index}`}
                cx={props.cx}
                cy={props.cy}
                r={props.index === lastIndex ? 4 : 0}
                fill={CHART_ACCENT}
                stroke="var(--color-card)"
                strokeWidth={2}
              />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
