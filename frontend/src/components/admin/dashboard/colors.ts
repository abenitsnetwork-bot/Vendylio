// Recharts needs real color strings, not Tailwind classes. These are drawn from
// the Vendylio theme tokens in globals.css (--color-primary #14201d,
// --color-accent #dd5b2e, --color-panel #16322d) plus a few in-between tones.

/** Donut / category slice palette — sage, coral, forest, gold, clay, stone. */
export const SLICE_COLORS = ['#16322d', '#dd5b2e', '#5c7a6f', '#e3a857', '#9c8b6f', '#b0563a'];

export const CHART_GRID = '#dbe2d6';
export const CHART_AXIS = '#756f5e';
export const CHART_INK = '#14201d';
export const CHART_ACCENT = '#dd5b2e';
export const CHART_POSITIVE = '#15803d';
export const CHART_NEGATIVE = '#b91c1c';

export const TOOLTIP_STYLE = { borderRadius: 10, borderColor: CHART_GRID, fontSize: 12 } as const;
