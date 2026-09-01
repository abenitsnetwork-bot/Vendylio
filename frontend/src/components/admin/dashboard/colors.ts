// Recharts needs real color strings, not Tailwind classes. These are drawn from
// the Vendylio theme tokens in globals.css (--color-primary #14201d,
// --color-accent #dd5b2e, --color-panel #16322d) plus a few in-between tones.

/**
 * Donut / category slice palette — forest, coral, teal, gold, slate-blue, clay,
 * sage, plum. Wider than the original six so a busy breakdown still reads, while
 * staying inside the warm-earth + forest-teal Vendylio range (no neon).
 */
export const SLICE_COLORS = [
  '#16322d', // forest
  '#dd5b2e', // coral
  '#2f8f83', // teal
  '#e3a857', // gold
  '#3b6ea5', // slate-blue
  '#b0563a', // clay
  '#5c7a6f', // sage
  '#8a5a83', // plum
];

/**
 * Fixed colour per payment method so the "Sales revenue" donut, its legend and
 * any per-method figure always agree. Keys match the labels produced by
 * /api/admin/pulse (`revenueMix[].method`).
 */
export const METHOD_COLORS: Record<string, string> = {
  Card: '#16322d',
  'Cash App': '#2f8f83',
  Zelle: '#3b6ea5',
  Other: '#9c8b6f',
};

export const CHART_GRID = '#dbe2d6';
export const CHART_AXIS = '#756f5e';
export const CHART_INK = '#14201d';
export const CHART_ACCENT = '#dd5b2e';
export const CHART_POSITIVE = '#15803d';
export const CHART_NEGATIVE = '#b91c1c';

export const TOOLTIP_STYLE = { borderRadius: 10, borderColor: CHART_GRID, fontSize: 12 } as const;
