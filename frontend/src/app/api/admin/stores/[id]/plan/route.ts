// PATCH /api/admin/stores/[id]/plan — SUPERADMIN sets a store's plan by hand.
//
// The intended use is comping Pro to a pilot / support case: plan=PRO writes
// planSource='COMP' + planCompExpiresAt (default 90 days), and the daily
// plan-downgrade-sweep cron retires it when that passes. plan=FREE clears a
// comp. A store paying via Stripe (planSource='SUBSCRIPTION') is refused here
// — cancel that through Stripe, not the back-office — so this can never
// silently strip a customer's paid plan.
//
// Every change is audited via logAdminAction (PROTECTED).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  plan: z.enum(['FREE', 'PRO']),
  // Only used when plan=PRO. Clamped 1..730.
  compDays: z.number().int().min(1).max(730).optional(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', message: 'Invalid request body' },
        { status: 400, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, plan: true, planSource: true, subscriptionStatus: true },
    });
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'Store not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    if (store.planSource === 'SUBSCRIPTION') {
      return NextResponse.json(
        {
          error: 'STRIPE_MANAGED_PLAN',
          message:
            'This store pays for Pro via Stripe — manage it through the subscription, not here.',
        },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const { plan } = parsed.data;
    const data =
      plan === 'PRO'
        ? {
            plan: 'PRO',
            planSource: 'COMP',
            planCompExpiresAt: new Date(
              Date.now() + (parsed.data.compDays ?? 90) * 24 * 60 * 60 * 1000,
            ),
          }
        : { plan: 'FREE', planSource: null, planCompExpiresAt: null };

    // Idempotent no-op for FREE→FREE (no audit noise).
    if (plan === 'FREE' && store.plan === 'FREE') {
      return NextResponse.json(
        { store: { id: store.id, plan: 'FREE' } },
        { headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.store.update({
      where: { id },
      data,
      select: { id: true, plan: true, planSource: true, planCompExpiresAt: true },
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: plan === 'PRO' ? 'store.plan.comp' : 'store.plan.free',
      targetType: 'Store',
      targetId: id,
      metadata: {
        from: store.plan,
        to: plan,
        ...(plan === 'PRO' ? { compDays: parsed.data.compDays ?? 90 } : {}),
      },
    });

    return NextResponse.json(
      {
        store: {
          ...updated,
          planCompExpiresAt: updated.planCompExpiresAt
            ? updated.planCompExpiresAt.toISOString()
            : null,
        },
      },
      { headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
