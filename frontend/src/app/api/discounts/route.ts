// GET  /api/discounts — the caller's own promo codes.
// POST /api/discounts — create one.
//
// Phase D. Seller-managed, per store. V1 mechanism is FREE_DELIVERY only —
// `kind` is not accepted from the client yet (forced below), so a code can
// only ever waive the delivery fee. Windows (startsAt/endsAt), the on/off
// switch, min-subtotal and the redemption cap are all editable at will.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { normalizeDiscountCode } from '@/lib/server/discounts/evaluate';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid date' });

export const DiscountCreateBody = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, "-" or "_" only'),
    active: z.boolean().optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    minSubtotalCents: z.number().int().min(0).max(100_000_00).optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  })
  .refine((d) => !(d.startsAt && d.endsAt) || Date.parse(d.startsAt) < Date.parse(d.endsAt), {
    message: 'The end date must be after the start date',
    path: ['endsAt'],
  });

function noStore(requestId: string): NextResponse {
  return NextResponse.json(
    { error: 'NO_STORE', message: 'Create a store before managing promo codes.' },
    { status: 404, headers: { 'x-request-id': requestId } },
  );
}

const SELECT = {
  id: true,
  code: true,
  kind: true,
  active: true,
  startsAt: true,
  endsAt: true,
  minSubtotalCents: true,
  maxRedemptions: true,
  redemptionCount: true,
  createdAt: true,
} as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) return noStore(ctx.requestId);

    const discounts = await prisma.discount.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: 'desc' },
      select: SELECT,
    });

    return NextResponse.json({ discounts }, { headers: { 'x-request-id': ctx.requestId } });
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) return noStore(ctx.requestId);

    const parsed = DiscountCreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const d = parsed.data;

    try {
      const created = await prisma.discount.create({
        data: {
          storeId: store.id,
          code: normalizeDiscountCode(d.code),
          kind: 'FREE_DELIVERY',
          active: d.active ?? true,
          startsAt: d.startsAt ? new Date(d.startsAt) : null,
          endsAt: d.endsAt ? new Date(d.endsAt) : null,
          minSubtotalCents: d.minSubtotalCents ?? 0,
          maxRedemptions: d.maxRedemptions ?? null,
        },
        select: SELECT,
      });
      return NextResponse.json(
        { discount: created },
        { status: 201, headers: { 'x-request-id': ctx.requestId } },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: 'CODE_TAKEN', message: 'You already have a promo code with that name.' },
          { status: 409, headers: { 'x-request-id': ctx.requestId } },
        );
      }
      throw err;
    }
  });
}
