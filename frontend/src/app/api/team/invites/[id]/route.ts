// DELETE /api/team/invites/[id] — revoke a pending invite (ADMIN+).
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth, requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function DELETE(
  req: NextRequest,
  route: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store first.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const orgCtx = await requireOrgRole(store.organizationId, 'ADMIN');
    if (orgCtx instanceof NextResponse) return orgCtx;

    const { id } = await route.params;
    const invite = await prisma.teamInvite.findUnique({
      where: { id },
      select: { id: true, organizationId: true, status: true },
    });
    if (!invite || invite.organizationId !== store.organizationId) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Invite not found.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    if (invite.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'NOT_PENDING', message: 'That invite is no longer pending.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    await prisma.teamInvite.update({ where: { id }, data: { status: 'REVOKED' } });
    return NextResponse.json({ ok: true }, { headers: { 'x-request-id': ctx.requestId } });
  });
}
