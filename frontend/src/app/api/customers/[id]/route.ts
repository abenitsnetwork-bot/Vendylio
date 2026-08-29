// GET /api/customers/[id] — Phase 6 customer detail + order history.
// Ownership via customer.storeId === callerStore.id (findOwnedCustomer),
// same 404-not-403 pattern as orders/products. Order history is matched by
// phone/email rather than a foreign key — Order has no customerId column;
// this mirrors exactly the (storeId, phone/email) match the Stripe webhook
// uses to upsert the Customer row in the first place (api/webhooks/stripe/route.ts).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { findOwnedCustomer } from '@/lib/server/customers/ownership';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const CUSTOMER_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  amount: true,
  currency: true,
  subtotalCents: true,
  deliveryFeeCents: true,
  taxCents: true,
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

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { customer } = await findOwnedCustomer(auth.user.sub, id);
    if (!customer) {
      return NextResponse.json(
        { error: 'CUSTOMER_NOT_FOUND', message: 'No such customer.' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const matchers: Prisma.OrderWhereInput[] = [];
    if (customer.phone) matchers.push({ customerPhone: customer.phone });
    if (customer.email) matchers.push({ customerEmail: customer.email });

    const orders =
      matchers.length === 0
        ? []
        : await prisma.order.findMany({
            where: { storeId: customer.storeId, OR: matchers },
            orderBy: { createdAt: 'desc' },
            select: CUSTOMER_ORDER_SELECT,
          });

    return NextResponse.json(
      { customer, orders },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
