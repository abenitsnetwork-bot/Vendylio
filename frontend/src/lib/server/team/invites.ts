// Phase 4a — team invitation helpers.
//
// A TeamInvite is a tokened link emailed to a prospective teammate. Accepting
// it creates their OrganizationMember row (role ADMIN or MEMBER — never
// OWNER). `resolveOwnStore` already resolves the store for any member, so the
// row is all that's needed for dashboard access; the OWNER-only routes
// (withdrawals, billing) add their own `requireOrgRole('OWNER')` check.
//
// Security: the token is the only credential, but acceptance ALSO requires
// the signed-in user's email to match the invite (a leaked link can't be
// redeemed by someone else), and a user who already belongs to an org can't
// join a second one (the app assumes one membership per user).
import 'server-only';
import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ORG_ROLE_RANK, type OrgRole } from '@/lib/server/middleware/require-org-role';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitableRole = Extract<OrgRole, 'ADMIN' | 'MEMBER'>;

export function isInvitableRole(v: string): v is InvitableRole {
  return v === 'ADMIN' || v === 'MEMBER';
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * An inviter can only grant a role strictly below their own rank
 * (OWNER can grant ADMIN or MEMBER; ADMIN can grant MEMBER only).
 */
export function canGrantRole(inviterRole: OrgRole, target: InvitableRole): boolean {
  return ORG_ROLE_RANK[inviterRole] > ORG_ROLE_RANK[target];
}

export type AcceptResult =
  | { ok: true; organizationId: string; role: InvitableRole }
  | {
      ok: false;
      code:
        | 'INVITE_NOT_FOUND'
        | 'INVITE_NOT_PENDING'
        | 'INVITE_EXPIRED'
        | 'EMAIL_MISMATCH'
        | 'ALREADY_IN_ORG';
    };

/**
 * Validate + redeem an invite for `userId`. Runs its own Serializable tx so
 * two concurrent accepts can't both create a membership.
 */
export async function acceptInvite(
  prisma: PrismaClient,
  input: { token: string; userId: string; userEmail: string; now?: Date },
): Promise<AcceptResult> {
  const now = input.now ?? new Date();
  const inviteEmail = normalizeInviteEmail(input.userEmail);

  return prisma.$transaction(
    async (tx: Prisma.TransactionClient): Promise<AcceptResult> => {
      const invite = await tx.teamInvite.findUnique({ where: { token: input.token } });
      if (!invite) return { ok: false, code: 'INVITE_NOT_FOUND' };
      if (invite.status !== 'PENDING') return { ok: false, code: 'INVITE_NOT_PENDING' };
      if (invite.expiresAt.getTime() < now.getTime()) {
        return { ok: false, code: 'INVITE_EXPIRED' };
      }
      if (normalizeInviteEmail(invite.email) !== inviteEmail) {
        return { ok: false, code: 'EMAIL_MISMATCH' };
      }

      const existing = await tx.organizationMember.findFirst({
        where: { userId: input.userId },
        select: { organizationId: true },
      });
      if (existing) {
        // Idempotent: already a member of THIS org → treat as success.
        if (existing.organizationId === invite.organizationId) {
          if (invite.status === 'PENDING') {
            await tx.teamInvite.update({
              where: { id: invite.id },
              data: { status: 'ACCEPTED', acceptedAt: now },
            });
          }
          return {
            ok: true,
            organizationId: invite.organizationId,
            role: isInvitableRole(invite.role) ? invite.role : 'MEMBER',
          };
        }
        return { ok: false, code: 'ALREADY_IN_ORG' };
      }

      const role: InvitableRole = isInvitableRole(invite.role) ? invite.role : 'MEMBER';
      await tx.organizationMember.create({
        data: { organizationId: invite.organizationId, userId: input.userId, role },
      });
      await tx.teamInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: now },
      });

      return { ok: true, organizationId: invite.organizationId, role };
    },
    { isolationLevel: 'Serializable' },
  );
}

/** Build the absolute invite-acceptance URL. */
export function inviteUrl(token: string): string {
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/team/accept?token=${encodeURIComponent(token)}`;
}
