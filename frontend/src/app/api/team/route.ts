// GET /api/team — the caller's organization: members + pending invites.
//
// Phase 4a. Any member can view the roster. Managing it (invite / revoke /
// change role / remove) is ADMIN+ or OWNER — the `canManage` flag tells the
// UI which controls to show; the mutation routes enforce it for real.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { requireAuth, requireOrgRole } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import { planFeatures } from '@/lib/server/plan/features';
import { ORG_ROLE_RANK, type OrgRole } from '@/lib/server/middleware/require-org-role';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;

    const store = await resolveOwnStore(auth.user.sub);
    if (!store) {
      return NextResponse.json(
        { error: 'NO_STORE', message: 'Create a store first.' },
        { status: 404, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const orgCtx = await requireOrgRole(store.organizationId, 'MEMBER');
    if (orgCtx instanceof NextResponse) return orgCtx;
    const myRole = orgCtx.orgMember.role as OrgRole;

    const [members, invites] = await Promise.all([
      prisma.organizationMember.findMany({
        where: { organizationId: store.organizationId },
        include: { user: { select: { id: true, email: true, name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.teamInvite.findMany({
        where: { organizationId: store.organizationId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    const features = planFeatures(store.plan);
    const canManage = ORG_ROLE_RANK[myRole] >= ORG_ROLE_RANK.ADMIN;

    return NextResponse.json(
      {
        myRole,
        canManage,
        isOwner: myRole === 'OWNER',
        plan: store.plan,
        teamMembersEnabled: features.teamMembers,
        members: members.map((m) => ({
          id: m.id,
          userId: m.userId,
          email: m.user.email,
          name: m.user.name,
          role: m.role,
          isYou: m.userId === auth.user.sub,
          createdAt: m.createdAt,
        })),
        invites,
      },
      { headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
