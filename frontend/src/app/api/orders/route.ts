// POST /api/orders — Phase 2 guest checkout (Phase 3 adds Stripe Connect
// routing — see step 9: a Store with stripeOnboardingStatus === 'ACTIVE'
// charges as a destination charge straight to the seller's connected
// account, Order.provider = 'stripe_connect'; everyone else keeps the
// Phase 2 platform-account path, Order.provider = 'stripe_platform').
//
// Sequence (mirrors the pre-Phase-0 Bictorys orders route's proven pattern,
// adapted for guest checkout + a real marketplace cart):
//   1. verifyCsrf(req)            — before any other work. Guests have no
//      CSRF cookie at all, so `verifyCsrf` only requires the header be
//      present (it skips the cookie-match check when no cookie exists —
//      see lib/server/auth.ts:192-211) — any non-empty header value from
//      the checkout page satisfies this.
//   2. optionalAuth()             — guest-first; a logged-in buyer is fine
//      too (Order.userId is set when present).
//   3. Idempotency-Key header     — Stripe-grade replay protection.
//   4. Zod parse body.
//   5. Fingerprint the body (storeId + sorted lineItems) — CR-02, scoped to
//      the cart contents now instead of a flat amount/currency.
//   6. Replay branch — echo the prior outcome, not a re-read of the row.
//   7. Resolve + validate the store (must exist, published) and each
//      product (must belong to the store, ACTIVE, enough stock). Prices are
//      always re-read from the DB — never trusted from the client.
//   8. Insert PENDING Order with the priced lineItems snapshot.
//   9. breaker.execute(provider.charge) — single-instance CircuitBreaker.
//  10. Update Order with the Stripe Checkout Session id + paymentUrl, 201.
//
// Stock is decremented at the PAID webhook, not here — an abandoned cart at
// this PENDING stage must not hold inventory hostage (MVP compromise, see
// the Phase 2 plan; a real reservation-with-TTL is a post-MVP hardening).
export const runtime = 'nodejs';

import 'server-only';
import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { optionalAuth, requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { prisma } from '@/lib/server/prisma';
import { CircuitOpenError } from '@/lib/server/payments/circuit-breaker';
import { computeCommission } from '@/lib/server/payments/commission';
import { getPlatformCommissionRates } from '@/lib/server/payments/platform-settings';
import {
  breaker,
  getProvider,
  PaymentProviderUnconfiguredError,
} from '@/lib/server/payments/provider-singleton';
import { clampLimit, cursorWhere, buildPage, decodeCursor } from '@/lib/server/pagination/paginate';
import { effectivePriceCents, variantLabel } from '@/lib/productVariants';
import { parseOrderNumberQuery } from '@/lib/orderNumber';
import { newTrackingToken } from '@/lib/server/orders/trackingToken';
import { storeAcceptsOrders } from '@/lib/server/store/availability';
import { roundQuantity } from '@/lib/quantity';
import { getUberDirectDeliveryFeeCents } from '@/lib/server/delivery/uber-direct';
import { evaluateDiscount, normalizeDiscountCode } from '@/lib/server/discounts/evaluate';

const IDEM_KEY_MAX_LEN = 200;
const ORDER_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24h PENDING window
const MAX_LINE_ITEMS = 50;

interface CartLine {
  productId: string;
  quantity: number;
  variantId?: string | undefined;
}

// CR-02 — SHA-256 of the canonicalized (storeId, sorted lineItems,
// fulfillmentMethod). Only the fields that affect what's charged are
// included (Phase 7: variantId too — a re-submit that swaps variants must
// not be treated as the same logical attempt; fulfillmentMethod too — it
// changes whether deliveryFeeCents applies, so a re-submit that switches
// Pickup↔Delivery under the same key must not silently reuse the old
// amount); customer contact details are excluded so a cosmetic re-submit
// (e.g. fixed typo in phone number) with the *same* Idempotency-Key still
// counts as the same logical attempt.
function fingerprintBody(input: {
  storeId: string;
  items: CartLine[];
  fulfillmentMethod: string;
  discountCode: string | null;
}): string {
  const sortedItems = [...input.items]
    .map((i) => ({ productId: i.productId, quantity: i.quantity, variantId: i.variantId ?? null }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const canonical = JSON.stringify({
    storeId: input.storeId,
    items: sortedItems,
    fulfillmentMethod: input.fulfillmentMethod,
    // Phase D — a re-submit that adds/removes/swaps the promo code changes
    // what's charged, so it must not silently reuse the old amount.
    discountCode: input.discountCode,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const Body = z.object({
  storeSlug: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        // Not .int() — a weight-unit product (KG/LB/G/OZ) allows fractional
        // amounts like 12.09 lb. Whole-number-for-UNIT is checked per item
        // below, once the product (and its unit) is in hand.
        quantity: z.number().positive(),
        variantId: z.string().trim().min(1).optional(),
      }),
    )
    .min(1)
    .max(MAX_LINE_ITEMS),
  customerName: z.string().trim().min(1).max(120),
  customerPhone: z.string().trim().min(3).max(30),
  customerEmail: z.string().trim().email().optional(),
  deliveryAddress: z.record(z.string(), z.unknown()).optional(),
  // Manual methods (Cash App/Zelle) skip Stripe entirely — see step 8b below.
  // Defaults to 'card' so every pre-existing checkout call (no payment
  // method field at all) keeps behaving exactly as before.
  paymentMethod: z.enum(['card', 'cashapp', 'zelle']).default('card'),
  // Buyer's fulfillment choice. Defaults to 'delivery' so every pre-existing
  // checkout call (no field at all) keeps behaving exactly as before —
  // deliveryFeeCents applies. 'pickup' zeroes the fee regardless of the
  // store's configured deliveryFeeCents.
  fulfillmentMethod: z.enum(['pickup', 'delivery']).default('delivery'),
  // Phase D — optional promo code. Validated + priced server-side below; an
  // invalid/expired code 400s (DISCOUNT_INVALID) rather than being ignored.
  discountCode: z.string().trim().min(1).max(40).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    // 1. CSRF (guest-safe — see file header)
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    // 2. Auth — optional, guest checkout is the norm
    const auth = await optionalAuth();

    // 3. Idempotency-Key header
    const idemKey = req.headers.get('idempotency-key') ?? '';
    if (!idemKey) {
      return NextResponse.json(
        { error: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header required' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    if (idemKey.length > IDEM_KEY_MAX_LEN) {
      return NextResponse.json(
        {
          error: 'IDEMPOTENCY_KEY_INVALID',
          message: `Idempotency-Key exceeds ${IDEM_KEY_MAX_LEN} characters`,
        },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // 4. Zod
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'VALIDATION_FAILED',
          message: 'Invalid request body',
          issues: parsed.error.issues,
        },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const {
      storeSlug,
      customerName,
      customerPhone,
      customerEmail,
      deliveryAddress,
      paymentMethod,
      fulfillmentMethod,
    } = parsed.data;
    const discountCode = parsed.data.discountCode
      ? normalizeDiscountCode(parsed.data.discountCode)
      : null;
    // Round every incoming quantity before it touches the fingerprint, the
    // stock check, or the stored lineItem snapshot — a client sending
    // 12.0900000001 must fingerprint/store identically to one sending 12.09.
    const items = parsed.data.items.map((item) => ({
      ...item,
      quantity: roundQuantity(item.quantity),
    }));

    // 5. Resolve the store early — needed for both the fingerprint and the
    // replay's body-mismatch comparison.
    const store = await prisma.store.findFirst({ where: { slug: storeSlug, published: true } });
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'No such store.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // Phase 8 — the merchant's hard pause switch. Enforced here so a client
    // that skips the disabled-checkout UI still can't place an order. Opening
    // hours are deliberately NOT enforced (soft/informational — the seller
    // may take orders for later).
    if (!storeAcceptsOrders(store)) {
      return NextResponse.json(
        {
          error: 'STORE_NOT_ACCEPTING_ORDERS',
          message: store.pauseMessage?.trim()
            ? store.pauseMessage.trim()
            : 'This store is not accepting orders right now.',
        },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (paymentMethod === 'cashapp' && !store.cashAppCashtag) {
      return NextResponse.json(
        { error: 'PAYMENT_METHOD_UNAVAILABLE', message: 'This store has not set up Cash App.' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    if (paymentMethod === 'zelle' && !store.zelleContact) {
      return NextResponse.json(
        { error: 'PAYMENT_METHOD_UNAVAILABLE', message: 'This store has not set up Zelle.' },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const bodyHash = fingerprintBody({ storeId: store.id, items, fulfillmentMethod, discountCode });

    // 6. Replay (echo the outcome, not a re-derivation of the row)
    const existing = await prisma.order.findUnique({ where: { idempotencyKey: idemKey } });
    if (existing) {
      if (existing.idempotencyBodyHash !== bodyHash) {
        return NextResponse.json(
          {
            error: 'IDEMPOTENCY_KEY_BODY_MISMATCH',
            message: 'Idempotency-Key already used for a different cart.',
          },
          { status: 422, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      if (existing.status === 'PENDING' || existing.status === 'PAID') {
        if (existing.status === 'PENDING' && !existing.paymentUrl) {
          return NextResponse.json(
            {
              error: 'PAYMENT_IN_FLIGHT',
              message: 'Prior attempt did not complete; retry shortly.',
            },
            { status: 503, headers: { 'x-request-id': ctx.requestId, 'Retry-After': '5' } },
          );
        }
        return NextResponse.json(
          {
            id: existing.id,
            trackingToken: existing.trackingToken,
            paymentUrl: existing.paymentUrl,
            status: existing.status,
          },
          { status: 200, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      return NextResponse.json(
        {
          error: 'PAYMENT_PROVIDER_UNAVAILABLE',
          message:
            'A previous attempt with this Idempotency-Key did not complete; submit a new key to retry.',
        },
        { status: 503, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // 7. Re-price every line server-side. Never trust client-sent prices.
    const productIds = items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, storeId: store.id, status: 'ACTIVE' },
      include: { variants: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    // Phase 7 — a product with variants requires the buyer to pick exactly
    // one (no "base" fallback that would silently ignore stock/pricing set
    // on the variant); a product without variants must not receive one
    // either. Both cases collapse to the same PRODUCT_UNAVAILABLE lookup
    // failure below rather than needing separate error codes.
    for (const item of items) {
      const product = productById.get(item.productId);
      if (!product) {
        return NextResponse.json(
          { error: 'PRODUCT_UNAVAILABLE', message: `Product ${item.productId} is not available.` },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      const variant = item.variantId
        ? product.variants.find((v) => v.id === item.variantId)
        : undefined;
      if (product.variants.length > 0 && !variant) {
        return NextResponse.json(
          {
            error: 'PRODUCT_UNAVAILABLE',
            message: `"${product.name}" requires selecting an option.`,
          },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      if (product.unit === 'UNIT' && !Number.isInteger(item.quantity)) {
        return NextResponse.json(
          {
            error: 'INVALID_QUANTITY',
            message: `"${product.name}" is sold per item — quantity must be a whole number.`,
          },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      const stockAvailable = variant ? variant.quantity : product.quantity;
      if (stockAvailable < item.quantity) {
        return NextResponse.json(
          {
            error: 'PRODUCT_UNAVAILABLE',
            message: `Only ${stockAvailable} of "${product.name}" left in stock.`,
          },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
    }

    const lineItems = items.map((item) => {
      const product = productById.get(item.productId)!;
      const variant = item.variantId
        ? product.variants.find((v) => v.id === item.variantId)
        : undefined;
      return {
        productId: product.id,
        name: product.name,
        priceCents: effectivePriceCents(product.priceCents, variant),
        quantity: item.quantity,
        unit: product.unit,
        ...(variant ? { variantId: variant.id, variantLabel: variantLabel(variant) } : {}),
      };
    });
    // Round each line to the nearest cent before summing — a fractional
    // quantity (12.09 lb at $5.00/lb) can otherwise produce a fractional
    // cent, which the Int `amount`/`subtotalCents` columns can't hold.
    const subtotalCents = lineItems.reduce(
      (sum, li) => sum + Math.round(li.priceCents * li.quantity),
      0,
    );
    // Pickup zeroes the fee regardless of the store's configured flat fee —
    // no courier is ever involved, the buyer collects the order in person.
    // A Delivery order at an Uber Direct store gets a REAL, distance-based
    // quote instead of the flat Store.deliveryFeeCents — falls back to the
    // flat fee if the quote can't be fetched (not configured, bad address,
    // Uber API error) so a checkout never fails just because a live quote
    // didn't come back.
    let deliveryFeeCents = 0;
    if (fulfillmentMethod === 'delivery') {
      deliveryFeeCents =
        store.deliveryProvider === 'uber_direct'
          ? ((await getUberDirectDeliveryFeeCents({
              pickupAddress: store.pickupAddress,
              deliveryAddress: deliveryAddress ?? null,
              amountCents: subtotalCents,
            })) ?? store.deliveryFeeCents)
          : store.deliveryFeeCents;
    }
    // Phase D — apply a promo code AFTER the delivery fee is known (V1's
    // only mechanism, FREE_DELIVERY, zeroes it). An invalid/expired code is
    // a hard 400 so the buyer knows to remove it, rather than silently
    // charging them the fee they thought was waived.
    let discountCents = 0;
    let appliedDiscountCode: string | null = null;
    if (discountCode) {
      const discount = await prisma.discount.findUnique({
        where: { storeId_code: { storeId: store.id, code: discountCode } },
        select: {
          kind: true,
          active: true,
          startsAt: true,
          endsAt: true,
          minSubtotalCents: true,
          maxRedemptions: true,
          redemptionCount: true,
        },
      });
      const result = evaluateDiscount(discount, { subtotalCents, deliveryFeeCents });
      if (!result.ok) {
        return NextResponse.json(
          {
            error: 'DISCOUNT_INVALID',
            code: result.reason,
            message: 'That promo code can’t be applied to this order.',
          },
          { status: 400, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      discountCents = result.discountCents;
      deliveryFeeCents = result.deliveryFeeCents;
      appliedDiscountCode = discountCode;
    }

    const taxCents = 0; // no tax engine in the MVP
    const amount = subtotalCents + deliveryFeeCents + taxCents;

    // Shared across both branches below — only `provider` (and, for Stripe,
    // the later providerChargeId/paymentUrl update) differs.
    const baseOrderData = {
      storeId: store.id,
      userId: auth?.user.sub ?? null,
      amount,
      currency: 'USD',
      status: 'PENDING' as const,
      subtotalCents,
      deliveryFeeCents,
      taxCents,
      discountCents,
      ...(appliedDiscountCode ? { discountCode: appliedDiscountCode } : {}),
      fulfillmentMethod: fulfillmentMethod.toUpperCase(),
      customerName,
      customerPhone,
      ...(customerEmail ? { customerEmail } : {}),
      ...(deliveryAddress ? { deliveryAddress: deliveryAddress as Prisma.InputJsonValue } : {}),
      lineItems: lineItems as unknown as Prisma.InputJsonValue,
      idempotencyKey: idemKey,
      idempotencyBodyHash: bodyHash,
      // Phase 7 — the guest tracking bearer credential. Generated here so it
      // exists on the row from creation; every customer-facing URL + email
      // link uses this, never `order.id`.
      trackingToken: newTrackingToken(),
      expiresAt: new Date(Date.now() + ORDER_EXPIRY_MS),
    };

    // 8a. Manual payment methods (Cash App/Zelle) skip Stripe entirely — no
    // provider call, no paymentUrl, no circuit breaker. The buyer sees the
    // seller's Cash App QR / Zelle contact on the success/tracking page
    // (GET /api/orders/[id]/track); the seller confirms receipt via
    // POST /api/orders/[id]/confirm-payment, which triggers the exact same
    // markPaid side effects a real Stripe payment would.
    if (paymentMethod !== 'card') {
      const order = await prisma.order.create({
        data: {
          ...baseOrderData,
          provider: paymentMethod === 'cashapp' ? 'cashapp_manual' : 'zelle_manual',
        },
      });
      return NextResponse.json(
        { id: order.id, trackingToken: order.trackingToken, paymentUrl: null, status: 'PENDING' },
        { status: 201, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // 8b. Lazy provider init (translate to 503, never 500)
    let provider;
    try {
      provider = getProvider();
    } catch (err) {
      if (err instanceof PaymentProviderUnconfiguredError) {
        return NextResponse.json(
          { error: 'PAYMENT_PROVIDER_UNCONFIGURED', message: 'Payment provider not configured' },
          { status: 503, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw err;
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

    // Phase 3 routing: a Store only routes through Connect once Stripe has
    // actually confirmed the connected account can take charges and receive
    // payouts (ACTIVE) — PENDING/RESTRICTED/NOT_STARTED all fall back to the
    // Phase 2 platform-account path, same as an unconnected store.
    const isConnected = store.stripeOnboardingStatus === 'ACTIVE' && Boolean(store.stripeAccountId);
    const orderProvider = isConnected ? 'stripe_connect' : 'stripe_platform';

    const order = await prisma.order.create({
      data: { ...baseOrderData, provider: orderProvider },
    });

    // 9. Wrap the charge call in the CircuitBreaker
    try {
      const chargeInput = {
        amount,
        currency: 'USD',
        customer: {
          name: customerName,
          phone: customerPhone,
          ...(customerEmail ? { email: customerEmail } : {}),
        },
        successUrl: `${appUrl}/s/${store.slug}/orders/${order.trackingToken}/success`,
        failureUrl: `${appUrl}/s/${store.slug}/orders/${order.trackingToken}/failed`,
        externalRef: order.id,
      };

      const result = await breaker.execute(async () => {
        if (isConnected) {
          const { baseRateBp } = await getPlatformCommissionRates(prisma);
          const { commission } = computeCommission(amount, baseRateBp);
          return provider.chargeConnected({
            ...chargeInput,
            destinationAccountId: store.stripeAccountId!,
            applicationFeeAmount: commission,
          });
        }
        return provider.charge(chargeInput);
      });

      // 10. Persist provider refs + return 201
      await prisma.order.update({
        where: { id: order.id },
        data: { providerChargeId: result.providerChargeId, paymentUrl: result.paymentUrl },
      });

      return NextResponse.json(
        {
          id: order.id,
          trackingToken: order.trackingToken,
          paymentUrl: result.paymentUrl,
          status: 'PENDING',
        },
        { status: 201, headers: { 'x-request-id': ctx.requestId } },
      );
    } catch (err) {
      if (err instanceof CircuitOpenError) {
        await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
        const retryAfterSec = Math.max(1, Math.ceil((err.retryAt.getTime() - Date.now()) / 1000));
        return NextResponse.json(
          {
            error: 'PAYMENT_PROVIDER_UNAVAILABLE',
            message: 'Payment provider temporarily unavailable. Try again shortly.',
          },
          {
            status: 503,
            headers: { 'x-request-id': ctx.requestId, 'Retry-After': String(retryAfterSec) },
          },
        );
      }

      await prisma.order.update({ where: { id: order.id }, data: { status: 'FAILED' } });
      const message = err instanceof Error ? err.message : 'Unknown payment error';
      return NextResponse.json(
        { error: 'PAYMENT_FAILED', message },
        { status: 502, headers: { 'x-request-id': ctx.requestId } },
      );
    }
  });
}

// GET /api/orders — Phase 4 seller-facing order list. Cursor-paginated,
// scoped to the caller's own store (never trusts a storeId from the
// client). Reuses the admin/withdrawals cursor pattern — see
// lib/server/pagination/paginate.ts.
const SELLER_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  amount: true,
  currency: true,
  subtotalCents: true,
  deliveryFeeCents: true,
  taxCents: true,
  fulfillmentMethod: true,
  customerName: true,
  customerPhone: true,
  customerEmail: true,
  deliveryAddress: true,
  lineItems: true,
  provider: true,
  paymentMethod: true,
  commissionAmount: true,
  netAmount: true,
  paidAt: true,
  createdAt: true,
} as const satisfies Prisma.OrderSelect;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'No store yet.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const url = req.nextUrl;
    const limit = clampLimit(url.searchParams.get('limit'));
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q')?.trim();
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    // ?q= — a merchant looking for one order. Matches the order number
    // ("VND-10042", "10042" or the bare internal value) OR a substring of
    // the customer's name / email. All server-side; no external search.
    let searchWhere: Prisma.OrderWhereInput | undefined;
    if (q) {
      const parsedNumber = parseOrderNumberQuery(q);
      searchWhere = {
        OR: [
          ...(parsedNumber !== null ? [{ orderNumber: parsedNumber }] : []),
          { customerName: { contains: q, mode: 'insensitive' as const } },
          { customerEmail: { contains: q, mode: 'insensitive' as const } },
        ],
      };
    }

    // Both searchWhere and cursorWhere use a top-level `OR` — merge them
    // under `AND` so one can't clobber the other during pagination.
    const cursorClause = cursorWhere(cursor) as Prisma.OrderWhereInput;
    const andClauses: Prisma.OrderWhereInput[] = [
      ...(searchWhere ? [searchWhere] : []),
      ...(Object.keys(cursorClause).length ? [cursorClause] : []),
    ];
    const where: Prisma.OrderWhereInput = {
      storeId: store.id,
      ...(status ? { status } : {}),
      ...(andClauses.length ? { AND: andClauses } : {}),
    };

    const rows = await prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SELLER_ORDER_SELECT,
    });

    const page = buildPage(rows, limit);
    return NextResponse.json(page, { headers: { 'x-request-id': ctx.requestId } });
  });
}
