// POST /api/team/invites — invite a teammate by email (Pro, ADMIN+).
//
// Phase 4a. Creates a PENDING TeamInvite and best-effort emails the tokened
// link (also returned as `inviteUrl` for a "copy link" UX). Gated behind
// `planFeatures().teamMembers` — a downgrade never evicts existing members,
// it only blocks new invites.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';

import { verifyCsrf } from '@/lib/server/auth';
import { requireAuth, requireOrgRole } from '@/lib/server/middleware';
import { requirePro } from '@/lib/server/middleware/require-pro';
import { prisma } from '@/lib/server/prisma';
import { resolveOwnStore } from '@/lib/server/org';
import type { OrgRole } from '@/lib/server/middleware/require-org-role';
import {
  INVITE_TTL_MS,
  canGrantRole,
  generateInviteToken,
  inviteUrl,
  isInvitableRole,
  normalizeInviteEmail,
} from '@/lib/server/team/invites';
import { sendTeamInviteNow } from '@/lib/server/team/send-invite-now';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

const Body = z.object({
  email: z.string().trim().email().max(200),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
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
    const myRole = orgCtx.orgMember.role as OrgRole;

    const gated = requirePro(store, 'teamMembers');
    if (gated) return gated;

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: parsed.error.issues },
        { status: 400, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    const email = normalizeInviteEmail(parsed.data.email);
    const role = parsed.data.role;

    if (!isInvitableRole(role) || !canGrantRole(myRole, role)) {
      return NextResponse.json(
        { error: 'ROLE_NOT_ALLOWED', message: 'You cannot grant a role at or above your own.' },
        { status: 403, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    if (email === auth.user.email.toLowerCase()) {
      return NextResponse.json(
        { error: 'CANNOT_INVITE_SELF', message: 'That is your own email.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const alreadyMember = await prisma.organizationMember.findFirst({
      where: { organizationId: store.organizationId, user: { email } },
      select: { id: true },
    });
    if (alreadyMember) {
      return NextResponse.json(
        { error: 'ALREADY_MEMBER', message: 'That person is already on your team.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const existingInvite = await prisma.teamInvite.findFirst({
      where: { organizationId: store.organizationId, email, status: 'PENDING' },
      select: { id: true },
    });
    if (existingInvite) {
      return NextResponse.json(
        { error: 'INVITE_PENDING', message: 'There is already a pending invite for that email.' },
        { status: 409, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const token = generateInviteToken();
    const invite = await prisma.teamInvite.create({
      data: {
        organizationId: store.organizationId,
        email,
        role,
        token,
        invitedByUserId: auth.user.sub,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
      select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
    });

    const url = inviteUrl(token);
    after(async () => {
      await sendTeamInviteNow({
        to: email,
        orgName: store.name,
        inviterEmail: auth.user.email,
        role,
        url,
      });
    });

    return NextResponse.json(
      { invite, inviteUrl: url },
      { status: 201, headers: { 'x-request-id': ctx.requestId } },
    );
  });
}
