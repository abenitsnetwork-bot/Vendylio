// Renders a variant option as a real color circle when its axis is a color
// (ProductVariant.name === "Color"/"Colour") AND its value is a recognized
// English color word — otherwise the picker falls back to a plain text
// pill. There's no `colorHex` field on ProductVariant (a seller just types
// "Red", "Large", "5kg" as free text), so this is a best-effort lookup, not
// a guarantee — an unrecognized color name (e.g. "Sunset Orange") still
// gets a pill, never a fabricated/incorrect color swatch.
const COLOR_NAMES: Record<string, string> = {
  black: '#111111',
  white: '#ffffff',
  red: '#dc2626',
  blue: '#2563eb',
  navy: '#1e3a5f',
  green: '#16a34a',
  yellow: '#eab308',
  pink: '#ec4899',
  purple: '#9333ea',
  orange: '#ea580c',
  gray: '#6b7280',
  grey: '#6b7280',
  brown: '#78350f',
  beige: '#e8dcc8',
  gold: '#ca8a04',
  silver: '#c0c0c0',
  cream: '#fdf6e3',
  tan: '#d2b48c',
  maroon: '#7f1d1d',
  teal: '#0d9488',
  turquoise: '#06b6d4',
  ivory: '#fffff0',
  charcoal: '#36454f',
  burgundy: '#800020',
  olive: '#556b2f',
  khaki: '#c3b091',
  lavender: '#e6e6fa',
  coral: '#dd5b2e',
};

/** True when this variant axis represents a color (case-insensitive). */
export function isColorAxis(variantName: string): boolean {
  const normalized = variantName.trim().toLowerCase();
  return normalized === 'color' || normalized === 'colour';
}

/** Hex code for a recognized color word (case/whitespace-insensitive), or
 * null when the value isn't in the lookup — callers fall back to a pill. */
export function colorNameToHex(value: string): string | null {
  return COLOR_NAMES[value.trim().toLowerCase()] ?? null;
}
