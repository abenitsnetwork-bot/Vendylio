// GET /api/team/invites/peek?token= — public, read-only preview of an invite.
//
// Lets the /team/accept page render "Join <store> as <role>" and decide which
// path to offer (sign in vs. set a password) BEFORE the visitor authenticates.
// The token was emailed to the invitee, so surfacing the target email + whether
// an account already exists for it is acceptable — it's the same person.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/server/prisma';
import { normalizeInviteEmail } from '@/lib/server/team/invites';
import { invitePeekIpLimiter } from '@/lib/server/middleware/rate-limit-by-ip';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const limited = await invitePeekIpLimiter.check(req);
    if (limited) return limited;

    const token = new URL(req.url).searchParams.get('token')?.trim() ?? '';
    const headers = { 'x-request-id': ctx.requestId };

    if (token.length < 10) {
      return NextResponse.json({ status: 'INVALID' }, { status: 200, headers });
    }

    const invite = await prisma.teamInvite.findUnique({
      where: { token },
      select: {
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        organization: { select: { name: true } },
      },
    });

    if (!invite) {
      return NextResponse.json({ status: 'INVALID' }, { status: 200, headers });
    }

    let status: 'PENDING' | 'USED' | 'EXPIRED' = 'PENDING';
    if (invite.status !== 'PENDING') status = 'USED';
    else if (invite.expiresAt.getTime() < Date.now()) status = 'EXPIRED';

    const email = normalizeInviteEmail(invite.email);
    const account = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    return NextResponse.json(
      {
        status,
        email,
        role: invite.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
        orgName: invite.organization.name,
        hasAccount: account !== null,
      },
      { status: 200, headers },
    );
  });
}
