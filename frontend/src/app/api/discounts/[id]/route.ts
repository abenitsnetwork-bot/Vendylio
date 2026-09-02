// PATCH  /api/discounts/[id] — edit a promo code (code, window, on/off,
//   min-subtotal, redemption cap — anything, any time).
// DELETE /api/discounts/[id] — remove it. Past orders keep their
//   `discountCode` string snapshot, so history is unaffected.
//
// Ownership: the discount's storeId must match the caller's store — 404
// (not 403) on a mismatch so a seller can't probe another store's ids.
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

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const isoDate = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid date' });

const PatchBody = z
  .object({
    code: z
      .string()
      .trim()
      .min(2)
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, numbers, "-" or "_" only')
      .optional(),
    kind: z.enum(['FREE_DELIVERY', 'PERCENT']).optional(),
    percentOff: z.number().int().min(1).max(100).nullable().optional(),
    active: z.boolean().optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    minSubtotalCents: z.number().int().min(0).max(100_000_00).optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update.' });

const SELECT = {
  id: true,
  code: true,
  kind: true,
  percentOff: true,
  active: true,
  startsAt: true,
  endsAt: true,
  minSubtotalCents: true,
  maxRedemptions: true,
  redemptionCount: true,
  createdAt: true,
} as const;

async function findOwned(userId: string, discountId: string) {
  const store = await resolveOwnStore(userId);
  if (!store) return { store: null, discount: null };
  const discount = await prisma.discount.findFirst({
    where: { id: discountId, storeId: store.id },
    select: { id: true, kind: true, percentOff: true, startsAt: true, endsAt: true },
  });
  return { store, discount };
}

function notFound(requestId: string): NextResponse {
  return NextResponse.json(
    { error: 'DISCOUNT_NOT_FOUND', message: 'No such promo code.' },
    { status: 404, headers: { 'x-request-id': requestId } },
  );
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { store, discount } = await findOwned(auth.user.sub, id);
    if (!store || !discount) return notFound(reqCtx.requestId);

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }
    const d = parsed.data;

    // Cross-field check against the merged (existing + patch) window.
    const nextStart =
      d.startsAt !== undefined ? (d.startsAt ? new Date(d.startsAt) : null) : discount.startsAt;
    const nextEnd =
      d.endsAt !== undefined ? (d.endsAt ? new Date(d.endsAt) : null) : discount.endsAt;
    if (nextStart && nextEnd && nextStart >= nextEnd) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'The end date must be after the start date.' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // Merge kind + percentOff, then require a valid percentage for PERCENT.
    const nextKind = d.kind ?? discount.kind;
    const nextPercent = d.percentOff !== undefined ? d.percentOff : (discount.percentOff ?? null);
    if (nextKind === 'PERCENT' && (nextPercent == null || nextPercent < 1 || nextPercent > 100)) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Set a percentage between 1 and 100.' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const data: Prisma.DiscountUpdateInput = {
      ...(d.code !== undefined ? { code: normalizeDiscountCode(d.code) } : {}),
      ...(d.kind !== undefined ? { kind: d.kind } : {}),
      ...(d.kind !== undefined || d.percentOff !== undefined
        ? { percentOff: nextKind === 'PERCENT' ? nextPercent : null }
        : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.startsAt !== undefined ? { startsAt: nextStart } : {}),
      ...(d.endsAt !== undefined ? { endsAt: nextEnd } : {}),
      ...(d.minSubtotalCents !== undefined ? { minSubtotalCents: d.minSubtotalCents } : {}),
      ...(d.maxRedemptions !== undefined ? { maxRedemptions: d.maxRedemptions } : {}),
    };

    try {
      const updated = await prisma.discount.update({ where: { id }, data, select: SELECT });
      return NextResponse.json(
        { discount: updated },
        { headers: { 'x-request-id': reqCtx.requestId } },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: 'CODE_TAKEN', message: 'You already have a promo code with that name.' },
          { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      throw err;
    }
  });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const { id } = await ctx.params;
    const { store, discount } = await findOwned(auth.user.sub, id);
    if (!store || !discount) return notFound(reqCtx.requestId);

    await prisma.discount.delete({ where: { id } });
    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
