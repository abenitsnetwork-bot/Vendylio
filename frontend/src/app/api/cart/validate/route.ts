// POST /api/cart/validate — pre-payment cart revalidation.
//
// The customer's cart lives in localStorage with the price / stock captured at
// add-to-cart time. Before they pay, the checkout page calls this to reconcile
// every line against the live database: a price the seller changed, a product
// that got archived, stock that dropped, a variant that disappeared, or the
// store pausing orders while the buyer sat on the page. POST /api/orders is
// still the authoritative gate — this just lets the buyer see and fix the
// difference instead of hitting a bare error at "Pay".
//
// Public + read-only: no auth (guest checkout), no writes. verifyCsrf is
// guest-safe (any header value passes when there's no cookie — same as the
// orders route). Product lookups are scoped to the store, so a productId from
// another store simply reads as REMOVED.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { quoteIpLimiter } from '@/lib/server/middleware/rate-limit-by-ip';
import { prisma } from '@/lib/server/prisma';
import { storeAcceptsOrders } from '@/lib/server/store/availability';
import { effectivePriceCents } from '@/lib/productVariants';
import { roundQuantity } from '@/lib/quantity';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const MAX_LINES = 50;

const Body = z.object({
  storeSlug: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        variantId: z.string().trim().min(1).optional(),
        quantity: z.number().positive(),
        // What the client currently believes the unit price is — lets us flag
        // PRICE_INCREASED / PRICE_DECREASED. Optional so a caller that doesn't
        // track it still gets stock/availability checks.
        priceCents: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(MAX_LINES),
});

type Change =
  | 'REMOVED'
  | 'OPTION_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'STOCK_REDUCED'
  | 'PRICE_INCREASED'
  | 'PRICE_DECREASED';

interface LineResult {
  productId: string;
  variantId: string | null;
  ok: boolean;
  name: string;
  currentPriceCents: number;
  availableQuantity: number;
  requestedQuantity: number;
  adjustedQuantity: number;
  changes: Change[];
}

const BLOCKING: ReadonlySet<Change> = new Set<Change>([
  'REMOVED',
  'OPTION_UNAVAILABLE',
  'OUT_OF_STOCK',
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const rl = await quoteIpLimiter.check(req); // API-01 — per-IP throttle
    if (rl) return rl;

    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const { storeSlug, items } = parsed.data;

    const store = await prisma.store.findFirst({ where: { slug: storeSlug, published: true } });
    if (!store) {
      return NextResponse.json(
        {
          storeOk: false,
          acceptingOrders: false,
          pauseMessage: null,
          lines: [],
          hasBlockingChange: true,
          hasPriceIncrease: false,
        },
        { headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, storeId: store.id, status: 'ACTIVE' },
      include: { variants: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines: LineResult[] = items.map((item) => {
      const requested = roundQuantity(item.quantity);
      const base: LineResult = {
        productId: item.productId,
        variantId: item.variantId ?? null,
        ok: false,
        name: 'This item',
        currentPriceCents: item.priceCents ?? 0,
        availableQuantity: 0,
        requestedQuantity: requested,
        adjustedQuantity: 0,
        changes: [],
      };

      const product = byId.get(item.productId);
      if (!product) return { ...base, changes: ['REMOVED'] };
      base.name = product.name;

      const variant = item.variantId
        ? product.variants.find((v) => v.id === item.variantId)
        : undefined;
      // Variant vanished, or the product gained/lost variants since add-to-cart.
      if ((item.variantId && !variant) || (product.variants.length > 0 && !variant)) {
        return { ...base, name: product.name, changes: ['OPTION_UNAVAILABLE'] };
      }

      const available = variant ? variant.quantity : product.quantity;
      const currentPrice = effectivePriceCents(product.priceCents, variant);
      const changes: Change[] = [];

      if (item.priceCents !== undefined && currentPrice !== item.priceCents) {
        changes.push(currentPrice > item.priceCents ? 'PRICE_INCREASED' : 'PRICE_DECREASED');
      }

      let adjusted = requested;
      if (available <= 0) {
        changes.push('OUT_OF_STOCK');
        adjusted = 0;
      } else if (available < requested) {
        changes.push('STOCK_REDUCED');
        adjusted = roundQuantity(available);
      }

      const ok = !changes.some((c) => BLOCKING.has(c));
      return {
        ...base,
        name: product.name,
        ok,
        currentPriceCents: currentPrice,
        availableQuantity: available,
        adjustedQuantity: adjusted,
        changes,
      };
    });

    const accepting = storeAcceptsOrders(store);
    return NextResponse.json(
      {
        storeOk: true,
        acceptingOrders: accepting,
        pauseMessage: accepting ? null : (store.pauseMessage?.trim() ?? null),
        lines,
        hasBlockingChange: !accepting || lines.some((l) => l.changes.some((c) => BLOCKING.has(c))),
        hasPriceIncrease: lines.some((l) => l.changes.includes('PRICE_INCREASED')),
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
