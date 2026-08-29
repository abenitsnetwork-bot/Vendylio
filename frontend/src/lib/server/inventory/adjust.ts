// Phase 3 — the single entry point for every stock mutation.
//
// Whether it's a paid sale, a refund putting stock back, or a seller
// editing a number by hand, it goes through applyStockChange(): it updates
// the Product/ProductVariant `quantity` AND writes a StockMovement ledger
// row in the same call, so the two can never drift. Callers pass their own
// Prisma transaction client so the quantity write, the ledger row, and
// whatever else the caller is doing all commit atomically.
import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { roundQuantity } from '@/lib/quantity';

// Accepts either the base client or a $transaction callback client — same
// shape webhook/handler.ts's PrismaTransactionClient uses.
type Tx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export const STOCK_REASONS = [
  'SALE',
  'RESTOCK',
  'MANUAL_ADJUST',
  'CORRECTION',
  'REFUND_RESTOCK',
] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export interface ApplyStockChangeInput {
  storeId: string;
  productId: string;
  /** null / undefined = the base product's stock; else the variant's. */
  variantId?: string | null;
  reason: StockReason;
  actorType: 'SYSTEM' | 'SELLER';
  note?: string | null;
  orderId?: string | null;
  /** Signed change (e.g. -3 for a sale). Provide this OR `newQuantity`. */
  delta?: number;
  /** Absolute target quantity. Provide this OR `delta`. */
  newQuantity?: number;
  /**
   * Clamp the result at 0. Used for SALE: a race between checkout and
   * payment shouldn't be able to drive stock negative — see markPaid.ts.
   */
  floorAtZero?: boolean;
  /**
   * The store's `defaultLowStockThreshold`, if the caller already has it —
   * lets a multi-line order avoid re-reading the Store row per item. Fetched
   * here when omitted.
   */
  storeDefaultLowStockThreshold?: number;
}

export interface ApplyStockChangeResult {
  before: number;
  after: number;
  delta: number;
  effectiveThreshold: number;
  /** Result is now > 0 but <= the effective threshold, and wasn't before. */
  crossedLowThreshold: boolean;
  /** Result is now <= 0, and wasn't before. */
  crossedZero: boolean;
}

export async function applyStockChange(
  tx: Tx,
  input: ApplyStockChangeInput,
): Promise<ApplyStockChangeResult> {
  if (input.delta === undefined && input.newQuantity === undefined) {
    throw new Error('applyStockChange: pass either `delta` or `newQuantity`');
  }

  const [before, productThreshold, storeDefault] = await readState(tx, input);

  let after =
    input.newQuantity !== undefined
      ? roundQuantity(input.newQuantity)
      : roundQuantity(before + (input.delta ?? 0));
  if (input.floorAtZero && after < 0) after = 0;

  const delta = roundQuantity(after - before);
  const effectiveThreshold = productThreshold ?? storeDefault;

  if (input.variantId) {
    await tx.productVariant.update({ where: { id: input.variantId }, data: { quantity: after } });
  } else {
    await tx.product.update({ where: { id: input.productId }, data: { quantity: after } });
  }

  await tx.stockMovement.create({
    data: {
      storeId: input.storeId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      delta,
      resultingQuantity: after,
      reason: input.reason,
      actorType: input.actorType,
      ...(input.note ? { note: input.note } : {}),
      ...(input.orderId ? { orderId: input.orderId } : {}),
    },
  });

  const crossedZero = before > 0 && after <= 0;
  const crossedLowThreshold =
    after > 0 && after <= effectiveThreshold && before > effectiveThreshold;

  return { before, after, delta, effectiveThreshold, crossedLowThreshold, crossedZero };
}

/** @returns [currentQuantity, product.lowStockThreshold, store.defaultLowStockThreshold] */
async function readState(
  tx: Tx,
  input: ApplyStockChangeInput,
): Promise<[number, number | null, number]> {
  const storeDefault =
    input.storeDefaultLowStockThreshold ??
    (
      await tx.store.findUniqueOrThrow({
        where: { id: input.storeId },
        select: { defaultLowStockThreshold: true },
      })
    ).defaultLowStockThreshold;

  if (input.variantId) {
    const [variant, product] = await Promise.all([
      tx.productVariant.findUniqueOrThrow({
        where: { id: input.variantId },
        select: { quantity: true },
      }),
      tx.product.findUniqueOrThrow({
        where: { id: input.productId },
        select: { lowStockThreshold: true },
      }),
    ]);
    return [variant.quantity, product.lowStockThreshold, storeDefault];
  }

  const product = await tx.product.findUniqueOrThrow({
    where: { id: input.productId },
    select: { quantity: true, lowStockThreshold: true },
  });
  return [product.quantity, product.lowStockThreshold, storeDefault];
}

/** OK | LOW | OUT for one product/variant given its effective threshold. */
export function stockStatus(quantity: number, effectiveThreshold: number): 'OK' | 'LOW' | 'OUT' {
  if (quantity <= 0) return 'OUT';
  if (quantity <= effectiveThreshold) return 'LOW';
  return 'OK';
}
