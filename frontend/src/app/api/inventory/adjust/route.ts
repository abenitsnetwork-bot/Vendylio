// POST /api/inventory/adjust — seller-initiated stock changes, one or many
// at a time (the inventory table uses this for both an inline single-field
// edit and a "adjust the selection" bulk action).
//
// Every line goes through applyStockChange inside one transaction, so the
// product/variant quantity and the StockMovement ledger stay in lockstep
// and a bad line rolls the whole batch back.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { applyStockChange } from '@/lib/server/inventory/adjust';
import { isValidQuantityForUnit } from '@/lib/quantity';

// Sellers may only RESTOCK / adjust / correct — SALE and REFUND_RESTOCK are
// written by the system (markPaid / refund) and never accepted here.
const SELLER_REASONS = ['RESTOCK', 'MANUAL_ADJUST', 'CORRECTION'] as const;

const Adjustment = z
  .object({
    productId: z.string().min(1),
    variantId: z.string().min(1).nullable().optional(),
    delta: z.number().finite().optional(),
    newQuantity: z.number().min(0).optional(),
    reason: z.enum(SELLER_REASONS),
    note: z.string().trim().max(280).optional(),
  })
  .refine((d) => (d.delta === undefined) !== (d.newQuantity === undefined), {
    message: 'Provide exactly one of `delta` or `newQuantity`.',
  });

const Body = z.object({
  adjustments: z.array(Adjustment).min(1).max(200),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const { adjustments } = parsed.data;

    // Ownership + unit/quantity validation up front, so we never open a
    // transaction we're going to abort.
    const productIds = [...new Set(adjustments.map((a) => a.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, storeId: store.id },
      select: { id: true, unit: true, variants: { select: { id: true } } },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const a of adjustments) {
      const product = productById.get(a.productId);
      if (!product) {
        return NextResponse.json(
          { error: 'PRODUCT_NOT_FOUND', message: `Unknown product ${a.productId}.` },
          { status: 404, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      if (a.variantId && !product.variants.some((v) => v.id === a.variantId)) {
        return NextResponse.json(
          { error: 'PRODUCT_NOT_FOUND', message: `Unknown variant ${a.variantId}.` },
          { status: 404, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      if (a.newQuantity !== undefined && !isValidQuantityForUnit(a.newQuantity, product.unit)) {
        return NextResponse.json(
          {
            error: 'VALIDATION_FAILED',
            message: `"${a.productId}" is sold per item — quantity must be a whole number.`,
          },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
    }

    const results = await prisma.$transaction(
      async (tx) => {
        const out = [];
        for (const a of adjustments) {
          const r = await applyStockChange(tx, {
            storeId: store.id,
            productId: a.productId,
            variantId: a.variantId ?? null,
            reason: a.reason,
            actorType: 'SELLER',
            note: a.note ?? null,
            storeDefaultLowStockThreshold: store.defaultLowStockThreshold,
            ...(a.delta !== undefined
              ? { delta: a.delta }
              : { newQuantity: a.newQuantity as number }),
          });
          out.push({
            productId: a.productId,
            variantId: a.variantId ?? null,
            before: r.before,
            after: r.after,
            status:
              r.after <= 0 ? 'OUT' : r.after <= r.effectiveThreshold ? 'LOW' : ('OK' as const),
          });
        }
        return out;
      },
      { isolationLevel: 'Serializable' },
    );

    return NextResponse.json({ results }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
