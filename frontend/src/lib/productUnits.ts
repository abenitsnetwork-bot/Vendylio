// Phase 7 — units of measure a Product's priceCents/quantity can be
// denominated in. UNIT ("per item") is the only mode that existed before
// this phase; the weight units let a seller price something like spices
// "per kg" WITH fractional quantities (e.g. 12.09 lb) — see the
// Product.unit comment in prisma/schema.prisma.
export const PRODUCT_UNITS = [
  { value: 'UNIT', label: 'Per item', suffix: '' },
  { value: 'LB', label: 'Per pound (lb)', suffix: '/lb' },
  { value: 'KG', label: 'Per kilogram (kg)', suffix: '/kg' },
  { value: 'G', label: 'Per gram (g)', suffix: '/g' },
  { value: 'OZ', label: 'Per ounce (oz)', suffix: '/oz' },
] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number]['value'];

/** Tuple of unit values — shaped for z.enum(). */
export const PRODUCT_UNIT_VALUES = PRODUCT_UNITS.map((u) => u.value) as [
  ProductUnit,
  ...ProductUnit[],
];

const LABELS: Record<ProductUnit, string> = Object.fromEntries(
  PRODUCT_UNITS.map((u) => [u.value, u.label]),
) as Record<ProductUnit, string>;

const SUFFIXES: Record<ProductUnit, string> = Object.fromEntries(
  PRODUCT_UNITS.map((u) => [u.value, u.suffix]),
) as Record<ProductUnit, string>;

export function productUnitLabel(value: string): string {
  return LABELS[value as ProductUnit] ?? value;
}

/** "/kg", "/lb", … — or "" for UNIT, where a bare price already reads fine. */
export function productUnitSuffix(value: string): string {
  return SUFFIXES[value as ProductUnit] ?? '';
}

/** "$5.00" for UNIT, "$5.00/kg" for a weight unit. */
export function formatUsdPerUnit(cents: number, unit: string): string {
  return `$${(cents / 100).toFixed(2)}${productUnitSuffix(unit)}`;
}

/**
 * Same price, split for a two-size display — the storefront renders `.cents`
 * smaller and raised (see components/storefront/PriceTag). `dollars`
 * includes the "$"; `cents` is always 2 digits; `suffix` is "/kg" etc. or "".
 */
export function splitUsdPerUnit(
  cents: number,
  unit: string,
): { dollars: string; cents: string; suffix: string } {
  const safe = Math.max(0, Math.round(cents));
  return {
    dollars: `$${Math.floor(safe / 100)}`,
    cents: String(safe % 100).padStart(2, '0'),
    suffix: productUnitSuffix(unit),
  };
}

/** "2" for UNIT, "12.09 lb" for a weight unit (always 2 decimals so a
 * float-arithmetic artifact like 12.0899999999999 never reaches the UI) —
 * used wherever a cart/order line shows how much of something was ordered. */
export function formatQuantityWithUnit(quantity: number, unit: string): string {
  return unit === 'UNIT' ? String(quantity) : `${quantity.toFixed(2)} ${unit.toLowerCase()}`;
}
