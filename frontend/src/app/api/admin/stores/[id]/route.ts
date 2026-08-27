// PATCH+DELETE /api/admin/stores/[id] — publish/unpublish and delete a
// store from the back-office.
//
// PATCH (publish toggle) is ADMIN-level — same precedent as the user
// suspend action (activate/deactivate) it mirrors; idempotent no-op on a
// same-state PATCH writes no AdminAction (matches users/[id]/status).
//
// DELETE is SUPERADMIN-only (destructive, matches withdrawal cancel).
// `Order.store` is `onDelete: Restrict` in the schema — a store with any
// order history physically cannot cascade-delete, by design (orders are
// financial/audit records). We check for that up front and return a clear
// 409 instead of letting a raw FK-violation bubble up, then delete via the
// Organization (cascades to Store + OrganizationMember + the store's
// Products/Customers/Reviews) rather than the Store row directly, so the
// tenant doesn't end up in the orphaned "Organization with no Store" state.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { verifyCsrf } from '@/lib/server/auth';
import { requireAdmin, requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  published: z.boolean(),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAdmin('ADMIN');
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

    const existing = await prisma.store.findUnique({
      where: { id },
      select: { id: true, published: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'Store not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // Idempotent no-op — same pattern as users/[id]/status (T-03-06-08
    // mitigation: no audit-log noise from repeated identical PATCHes).
    if (existing.published === parsed.data.published) {
      return NextResponse.json(
        { store: { id: existing.id, published: existing.published } },
        { headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const updated = await prisma.store.update({
      where: { id },
      data: { published: parsed.data.published },
      select: { id: true, published: true },
    });

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: parsed.data.published ? 'store.publish' : 'store.unpublish',
      targetType: 'Store',
      targetId: id,
      metadata: { from: existing.published, to: parsed.data.published },
    });

    return NextResponse.json({ store: updated }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}

export async function DELETE(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, slug: true, name: true, organizationId: true },
    });
    if (!store) {
      return NextResponse.json(
        { error: 'STORE_NOT_FOUND', message: 'Store not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const orderCount = await prisma.order.count({ where: { storeId: id } });
    if (orderCount > 0) {
      return NextResponse.json(
        {
          error: 'STORE_HAS_ORDERS',
          message: 'This store has order history and cannot be deleted — deactivate it instead.',
        },
        { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    // Delete via the Organization (not the Store row directly) so the
    // tenant doesn't end up as an orphaned org with no store — cascades to
    // Store, OrganizationMember, and the store's Products/Customers/Reviews.
    // Logged AFTER a successful delete (not before) so a race-condition
    // failure here — e.g. an order slipping in between the count check
    // above and this delete, tripping the same Restrict constraint —
    // never leaves a false "deleted" entry in the audit log.
    try {
      await prisma.organization.delete({ where: { id: store.organizationId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        return NextResponse.json(
          {
            error: 'STORE_HAS_ORDERS',
            message: 'This store has order history and cannot be deleted — deactivate it instead.',
          },
          { status: 409, headers: { 'x-request-id': reqCtx.requestId } },
        );
      }
      throw err;
    }

    await logAdminAction(prisma, {
      actorId: auth.admin.id,
      action: 'store.delete',
      targetType: 'Store',
      targetId: id,
      metadata: { slug: store.slug, name: store.name },
    });

    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': reqCtx.requestId } });
  });
}
