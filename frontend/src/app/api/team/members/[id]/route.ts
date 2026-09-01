// PATCH  /api/team/members/[id] — change a member's role (OWNER only).
// DELETE /api/team/members/[id] — remove a member (OWNER, or the member
//   removing themselves). The OWNER can never be changed or removed here.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth, requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const PatchBody = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });

async function loadContext(sub: string, requestId: string) {
  const store = await resolveOwnStore(sub);
  if (!store) {
    return {
      error: NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store first.' },
        { status: 404, headers: { 'x-request-id': requestId } },
      ),
    } as const;
  }
  return { store } as const;
}

export async function PATCH(
  req: NextRequest,
  route: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const loaded = await loadContext(auth.user.sub, ctx.requestId);
    if ('error' in loaded) return loaded.error;
    const { store } = loaded;

    const orgCtx = await requireOrgRole(store.organizationId, 'OWNER');
    if (orgCtx instanceof NextResponse) return orgCtx;

    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const { id } = await route.params;
    const member = await prisma.organizationMember.findUnique({
      where: { id },
      select: { id: true, organizationId: true, role: true, userId: true },
    });
    if (!member || member.organizationId !== store.organizationId) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Member not found.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    if (member.role === 'OWNER') {
      return NextResponse.json(
        { error: 'CANNOT_CHANGE_OWNER', message: 'The owner role cannot be changed.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const updated = await prisma.organizationMember.update({
      where: { id },
      data: { role: parsed.data.role },
      select: { id: true, role: true, userId: true },
    });
    return NextResponse.json({ member: updated }, { headers: { 'x-request-id': ctx.requestId } });
  });
}

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

    const loaded = await loadContext(auth.user.sub, ctx.requestId);
    if ('error' in loaded) return loaded.error;
    const { store } = loaded;

    // Must at least be a member of this org.
    const orgCtx = await requireOrgRole(store.organizationId, 'MEMBER');
    if (orgCtx instanceof NextResponse) return orgCtx;

    const { id } = await route.params;
    const member = await prisma.organizationMember.findUnique({
      where: { id },
      select: { id: true, organizationId: true, role: true, userId: true },
    });
    if (!member || member.organizationId !== store.organizationId) {
      return NextResponse.json(
        { error: 'NOT_FOUND', message: 'Member not found.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    if (member.role === 'OWNER') {
      return NextResponse.json(
        { error: 'CANNOT_REMOVE_OWNER', message: 'The store owner cannot be removed.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const isSelf = member.userId === auth.user.sub;
    const isOwner = orgCtx.orgMember.role === 'OWNER';
    if (!isSelf && !isOwner) {
      return NextResponse.json(
        { error: 'ORG_ROLE_INSUFFICIENT', message: 'Only the owner can remove other members.' },
        { status: 403, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    await prisma.organizationMember.delete({ where: { id } });
    return NextResponse.json(
      { ok: true, leftOrg: isSelf },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
