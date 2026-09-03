// Recharts needs real color strings, not Tailwind classes — so these resolve to
// `var(--chart-*)` custom properties defined per theme in globals.css. Because
// SVG presentation attributes resolve CSS variables live, flipping the theme
// recolors every chart with no React re-render. Light = the warm-earth +
// forest-teal Vendylio range; dark brightens every hue so stats stay legible on
// the near-black ground.

/**
 * Donut / category slice palette — forest, coral, teal, gold, slate-blue, clay,
 * sage, plum. Wide enough that a busy breakdown still reads.
 */
export const SLICE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

/**
 * Fixed colour per payment method so the "Sales revenue" donut, its legend and
 * any per-method figure always agree. Keys match the labels produced by
 * /api/admin/pulse (`revenueMix[].method`).
 */
export const METHOD_COLORS: Record<string, string> = {
  Card: 'var(--chart-method-card)',
  'Cash App': 'var(--chart-method-cashapp)',
  Zelle: 'var(--chart-method-zelle)',
  Other: 'var(--chart-method-other)',
};

export const CHART_GRID = 'var(--chart-grid)';
export const CHART_AXIS = 'var(--chart-axis)';
export const CHART_INK = 'var(--chart-ink)';
export const CHART_ACCENT = 'var(--chart-accent)';
export const CHART_POSITIVE = 'var(--chart-positive)';
export const CHART_NEGATIVE = 'var(--chart-negative)';
/** Faint fill for the "not the peak" bars in the analytics hour/day strips. */
export const CHART_BAR_IDLE = 'var(--chart-bar-idle)';

export const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: '1px solid var(--chart-grid)',
  background: 'var(--chart-tooltip-bg)',
  color: 'var(--color-foreground)',
  fontSize: 12,
} as const;
