// Shared quantity rounding/validation — a UNIT product's stock is always a
// whole count, but a weight unit (KG/LB/G/OZ) needs fractional amounts like
// 12.09 lb. Every write of a Product/ProductVariant quantity (creation,
// edit, checkout stock check, webhook decrement) rounds through here so
// float drift never accumulates across repeated arithmetic.
export function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100;
}

/** UNIT products must keep a whole-number count; weight units may be fractional. */
export function isValidQuantityForUnit(quantity: number, unit: string): boolean {
  return unit === 'UNIT' ? Number.isInteger(quantity) : Number.isFinite(quantity);
}
