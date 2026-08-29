// Phase 6 — how the sequential `Order.orderNumber` is shown to humans.
//
// Customers and merchants see "VND-10042", never the raw cuid `id`. The
// +10000 offset is cosmetic: it keeps a brand-new store's first orders from
// reading as "VND-1" / "VND-2" while staying a plain, memorable number.
// Pure + shared by client and server.

const ORDER_NUMBER_OFFSET = 10000;
const PREFIX = 'VND-';

/** e.g. formatOrderNumber(42) === "VND-10042" */
export function formatOrderNumber(orderNumber: number): string {
  return `${PREFIX}${orderNumber + ORDER_NUMBER_OFFSET}`;
}

/**
 * Best-effort parse of a merchant's search input back to a raw
 * `Order.orderNumber`. Accepts "VND-10042", "vnd 10042", "10042", or the
 * bare internal "42". Returns null when the input isn't a plausible order
 * number (so the caller can fall back to a name/email search).
 */
export function parseOrderNumberQuery(input: string): number | null {
  const digits = input
    .trim()
    .replace(/^vnd[\s-]*/i, '')
    .replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  // A value in the display range maps back through the offset; a small bare
  // value is treated as the raw column value.
  return n >= ORDER_NUMBER_OFFSET ? n - ORDER_NUMBER_OFFSET : n;
}
