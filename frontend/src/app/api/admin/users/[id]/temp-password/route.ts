// POST /api/admin/users/[id]/temp-password
//
// SUPERADMIN-only account recovery: a merchant or store manager who is
// locked out (forgot their password, no access to email, etc.) gets a
// one-time temporary password. In one tx we:
//   1. hash a freshly generated random password,
//   2. write it to User.passwordHash, bump tokenVersion (kills every existing
//      session, incl. any attacker's), set mustChangePassword = true,
//   3. write an AdminAction — WITHOUT the password in the metadata.
// We also clear the login lockout counter so the user can sign in immediately.
//
// The plaintext password is returned ONCE in the response body and is never
// logged or stored. The authed shell forces the user to /settings to choose
// a new password on their next sign-in (mustChangePassword).
export const runtime = 'nodejs';

import 'server-only';
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCsrf, hashPassword } from '@/lib/server/auth';
import { requireSuperadmin } from '@/lib/server/middleware';
import { prisma } from '@/lib/server/prisma';
import { logAdminAction } from '@/lib/server/admin/audit';
import { recordSuccess } from '@/lib/server/auth/lockout';
import { isBanned } from '@/lib/server/auth/banned-passwords';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';
import { log } from '@/lib/server/observability/log';

// Unambiguous alphabet (no 0/O/1/l/I), mixed case + digits. 20 chars from a
// 56-symbol set ≈ 116 bits — comfortably past any policy minimum and not in
// any common-password list, but we still check isBanned() defensively.
const TEMP_PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PW_LENGTH = 20;

function generateTempPassword(): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.randomBytes(TEMP_PW_LENGTH);
    let out = '';
    for (let i = 0; i < TEMP_PW_LENGTH; i++) {
      out += TEMP_PW_ALPHABET[bytes[i]! % TEMP_PW_ALPHABET.length];
    }
    if (!isBanned(out)) return out;
  }
  // Astronomically unlikely; fall back to raw hex so we never loop forever.
  return crypto.randomBytes(24).toString('hex');
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const reqCtx = makeRequestContext(req.headers);
  return withRequestContext(reqCtx, async () => {
    const csrfFail = verifyCsrf(req);
    if (csrfFail) return csrfFail;

    const auth = await requireSuperadmin();
    if (auth instanceof NextResponse) return auth;

    const limited = await enforceAdminRateLimit(auth.admin.id);
    if (limited) return limited;

    const { id } = await ctx.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, passwordHash: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: 'USER_NOT_FOUND', message: 'User not found' },
        { status: 404, headers: { 'x-request-id': reqCtx.requestId } },
      );
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
          mustChangePassword: true,
        },
      });
      await logAdminAction(tx, {
        actorId: auth.admin.id,
        action: 'user.temp_password',
        targetType: 'User',
        targetId: user.id,
        // NEVER the password. Just enough to answer "who did what".
        metadata: {
          email: user.email,
          targetRole: user.role,
          hadPassword: user.passwordHash !== null,
        },
      });
    });

    // Credentials just changed by an authorized SUPERADMIN — clear any
    // lockout so the user isn't blocked on their first attempt.
    await recordSuccess(user.email);

    log.info('admin issued temporary password', { actorId: auth.admin.id, userId: user.id });

    return NextResponse.json(
      { tempPassword, email: user.email },
      { status: 200, headers: { 'x-request-id': reqCtx.requestId } },
    );
  });
}
