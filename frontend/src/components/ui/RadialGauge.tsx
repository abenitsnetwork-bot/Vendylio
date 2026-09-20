'use client';

import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from 'recharts';

// Small circular progress gauge (0-100). Uses recharts' RadialBarChart —
// already a project dependency (v3, native radial support) — colored via a
// `var(--...)` string so it resolves live against the current theme, same
// convention as components/admin/dashboard/colors.ts.
export function RadialGauge({
  value,
  color = 'var(--chart-accent)',
  size = 96,
}: {
  value: number;
  color?: string;
  size?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const data = [{ value: clamped }];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={data}
          innerRadius="72%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
          barSize={9}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar
            dataKey="value"
            cornerRadius={20}
            fill={color}
            background={{ fill: 'var(--chart-bar-idle)' }}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <p className="font-headings text-lg font-bold text-foreground">{Math.round(clamped)}%</p>
      </div>
    </div>
  );
}
