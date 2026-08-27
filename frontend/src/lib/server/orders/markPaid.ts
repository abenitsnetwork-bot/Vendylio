// Shared "an order just got paid" side effects — commission calc, stock
// decrement, audit trail, guest-customer upsert, outbox notifications.
// Extracted from api/webhooks/stripe/route.ts (Phase 2/4/6/7/12) so the new
// manual Cash App / Zelle confirmation flow (no webhook exists for those —
// see lib/server/orders/manualPayment.ts) can reuse the EXACT same logic
// a real Stripe payment triggers, instead of drifting out of sync with a
// second copy. The caller is responsible for the entry-point-specific
// lookup + "is this order actually PENDING" check (the two call sites find
// the order differently: by providerChargeId for Stripe, by id + ownership
// for a manual confirm) — this function assumes that's already done.
import 'server-only';
import { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from '@/lib/server/webhook/handler';
import { computeCommission, resolveCommissionRateBp } from '@/lib/server/payments/commission';
import { enqueueOutbox } from '@/lib/server/outbox';
import { roundQuantity } from '@/lib/quantity';

interface OrderLineItem {
  productId: string;
  quantity: number;
  variantId?: string;
}

export interface OrderForPaidEffects {
  id: string;
  storeId: string;
  amount: number;
  currency: string;
  lineItems: Prisma.JsonValue;
  customerPhone: string | null;
  customerName: string | null;
  customerEmail: string | null;
  deliveryAddress: Prisma.JsonValue;
}

export async function applyOrderPaidEffects(
  tx: PrismaTransactionClient,
  order: OrderForPaidEffects,
  opts: { paymentMethod?: string | null } = {},
): Promise<void> {
  // Fetched once up front — reused below both for the Phase 12 PRO
  // commission discount and for the seller notification's userId, instead
  // of two separate round-trips to the same row.
  const store = await tx.store.findUnique({
    where: { id: order.storeId },
    select: { plan: true, organization: { select: { ownerId: true } } },
  });

  const baseRateBp = Number(process.env.COMMISSION_RATE_BP || 0) || 0;
  const proRateBpRaw = process.env.COMMISSION_RATE_BP_PRO;
  const proRateBp = proRateBpRaw ? Number(proRateBpRaw) || 0 : null;
  const rateBp = resolveCommissionRateBp({ plan: store?.plan ?? 'FREE', baseRateBp, proRateBp });
  const { commission, net } = computeCommission(order.amount, rateBp);
  const paymentMethod = opts.paymentMethod ?? null;

  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'PAID',
      paidAt: new Date(),
      commissionAmount: commission,
      netAmount: net,
      ...(paymentMethod !== null ? { paymentMethod } : {}),
    },
  });

  // Phase 4 — audit trail. The seller's later PREPARING→...→DELIVERED
  // clicks (api/orders/[id]/route.ts) each write their own SYSTEM/SELLER
  // row; this is the first entry so the trail starts at the actual
  // payment moment, not silently after the seller's first manual click.
  await tx.orderStatusEvent.create({
    data: { orderId: order.id, status: 'PAID', actorType: 'SYSTEM' },
  });

  // Decrement stock now (not at checkout creation) — see the file header
  // of app/api/orders/route.ts for why. Floored at 0: a concurrent sale
  // racing between checkout and payment is a known MVP compromise; the
  // floor just avoids a nonsensical negative count rather than pretending
  // to solve the race. Phase 7 — a lineItem carrying a variantId decrements
  // that ProductVariant's own quantity instead of the parent Product's
  // (variant stock is authoritative once a product has variants at all —
  // see the ProductVariant comment in schema.prisma).
  const lineItems = order.lineItems as unknown as OrderLineItem[];
  for (const item of lineItems) {
    if (item.variantId) {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { quantity: true },
      });
      if (!variant) continue;
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { quantity: roundQuantity(Math.max(0, variant.quantity - item.quantity)) },
      });
      continue;
    }
    const product = await tx.product.findUnique({
      where: { id: item.productId },
      select: { quantity: true },
    });
    if (!product) continue;
    await tx.product.update({
      where: { id: item.productId },
      data: { quantity: roundQuantity(Math.max(0, product.quantity - item.quantity)) },
    });
  }

  // Phase 6 — upsert the guest-customer directory. Keyed on (storeId,
  // phone): phone is required at checkout (Body schema) so it's always
  // present, unlike email. Overwrites name/email/address with the latest
  // order's values on repeat purchases — simpler than conditionally
  // preserving older data, and a repeat customer's checkout info is
  // usually the more accurate one anyway.
  if (order.customerPhone) {
    const existingCustomer = await tx.customer.findUnique({
      where: { storeId_phone: { storeId: order.storeId, phone: order.customerPhone } },
    });
    const customerData = {
      ...(order.customerName ? { name: order.customerName } : {}),
      ...(order.customerEmail ? { email: order.customerEmail } : {}),
      ...(order.deliveryAddress ? { address: order.deliveryAddress as Prisma.InputJsonValue } : {}),
    };
    try {
      if (existingCustomer) {
        await tx.customer.update({
          where: { id: existingCustomer.id },
          data: {
            ...customerData,
            ordersCount: { increment: 1 },
            totalSpentCents: { increment: order.amount },
          },
        });
      } else {
        await tx.customer.create({
          data: {
            storeId: order.storeId,
            phone: order.customerPhone,
            ordersCount: 1,
            totalSpentCents: order.amount,
            ...customerData,
          },
        });
      }
    } catch (err) {
      // A different phone sharing this order's email under the same store
      // would collide on the (storeId, email) unique constraint — an edge
      // case in a denormalized guest directory. The payment itself must
      // not fail because of it, so skip the directory update and move on.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) {
        throw err;
      }
    }
  }

  // Outbox emits stay inside the caller's Serializable tx so the rows
  // commit atomically with the status change. The drain cron picks them up
  // out-of-band. `store` was already fetched above for the commission calc.
  if (store) {
    await enqueueOutbox(tx, {
      kind: 'notification.order_paid',
      payload: {
        userId: store.organization.ownerId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
    });
  }
  if (order.customerEmail) {
    await enqueueOutbox(tx, {
      kind: 'email.order_confirmation',
      payload: {
        to: order.customerEmail,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
    });
  }
}
