// Team invite — one-step account claim.
//
// A teammate invited by email who has NO Vendylio account yet was previously
// stuck: the /team/accept page told them to "sign in", but they had nothing to
// sign in with, and /register + email verification is a long detour. This
// helper lets them set a password straight from the invite link.
//
// Treating the invite email as verified is safe: the tokened link was delivered
// to that address by us (same trust model as password-reset). The new user is
// created with `emailVerifiedAt` set and dropped straight into the org.
import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '@/lib/server/auth';
import { isBanned } from '@/lib/server/auth/banned-passwords';
import {
  isInvitableRole,
  normalizeInviteEmail,
  type InvitableRole,
} from '@/lib/server/team/invites';

const PASSWORD_MIN = Number(process.env.AUTH_PASSWORD_MIN_LENGTH ?? 10);

export type ClaimResult =
  | { ok: true; userId: string; email: string; tokenVersion: number; role: InvitableRole }
  | {
      ok: false;
      code:
        | 'INVITE_NOT_FOUND'
        | 'INVITE_NOT_PENDING'
        | 'INVITE_EXPIRED'
        | 'ACCOUNT_EXISTS'
        | 'PASSWORD_BANNED'
        | 'PASSWORD_TOO_SHORT';
    };

/**
 * Redeem an invite by creating a brand-new, email-verified account for the
 * invite's address and joining the org — all in one Serializable tx. Refuses
 * (ACCOUNT_EXISTS) if a user already exists for that email: that person must
 * sign in and use the authenticated accept flow instead.
 */
export async function claimInviteWithNewAccount(
  prisma: PrismaClient,
  input: { token: string; password: string; name?: string | undefined; now?: Date },
): Promise<ClaimResult> {
  const now = input.now ?? new Date();

  // Password policy — same gates as /api/auth/set-password, before any DB work.
  if (isBanned(input.password)) return { ok: false, code: 'PASSWORD_BANNED' };
  if (input.password.length < PASSWORD_MIN) return { ok: false, code: 'PASSWORD_TOO_SHORT' };

  const invite = await prisma.teamInvite.findUnique({ where: { token: input.token } });
  if (!invite) return { ok: false, code: 'INVITE_NOT_FOUND' };
  if (invite.status !== 'PENDING') return { ok: false, code: 'INVITE_NOT_PENDING' };
  if (invite.expiresAt.getTime() < now.getTime()) return { ok: false, code: 'INVITE_EXPIRED' };

  const email = normalizeInviteEmail(invite.email);
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, code: 'ACCOUNT_EXISTS' };

  const passwordHash = await hashPassword(input.password);
  const role: InvitableRole = isInvitableRole(invite.role) ? invite.role : 'MEMBER';

  try {
    return await prisma.$transaction(
      async (tx: Prisma.TransactionClient): Promise<ClaimResult> => {
        // Re-check the invite inside the tx — a concurrent accept/revoke could
        // have landed between the read above and here.
        const fresh = await tx.teamInvite.findUnique({ where: { id: invite.id } });
        if (!fresh || fresh.status !== 'PENDING') {
          return { ok: false, code: 'INVITE_NOT_PENDING' };
        }

        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            emailVerifiedAt: now,
            ...(input.name ? { name: input.name } : {}),
          },
          select: { id: true, email: true, tokenVersion: true },
        });
        await tx.organizationMember.create({
          data: { organizationId: fresh.organizationId, userId: user.id, role },
        });
        await tx.teamInvite.update({
          where: { id: fresh.id },
          data: { status: 'ACCEPTED', acceptedAt: now },
        });

        return {
          ok: true,
          userId: user.id,
          email: user.email,
          tokenVersion: user.tokenVersion,
          role,
        };
      },
      { isolationLevel: 'Serializable' },
    );
  } catch (err) {
    // Unique-email race: someone registered that address between our check and
    // the insert. Same outcome as the pre-check.
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002'
    ) {
      return { ok: false, code: 'ACCOUNT_EXISTS' };
    }
    throw err;
  }
}
