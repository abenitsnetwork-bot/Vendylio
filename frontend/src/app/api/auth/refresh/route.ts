// POST /api/auth/refresh — AUTH-04 single-flight refresh.
//
// Source: RESEARCH.md Pattern 12 + Pattern 5 caller pattern.
//
// Flow:
//   1. Read refresh cookie (path-scoped /api/auth — D-21)
//   2. verifyRefreshToken → 401 on bad token
//   3. user.findUnique by sub → 401 if deleted
//   4. tokenVersion DB check → 401 on mismatch (D-19, T-1-02 mitigation)
//   5. acquireRefreshLock(userId) → best-effort: retry-with-backoff on
//      contention, then proceed lock-less rather than 409 (D-20; see the
//      inline note — a hard 409 surfaced as a spurious client-side logout)
//   6. Mint new access + refresh + csrf cookies
//   7. release lock in finally if held (Pitfall 6 — release even on error)
//
// No CSRF check: refresh is itself authenticated via the refresh cookie and is
// path-scoped to /api/auth. The refresh cookie cannot be used cross-site for
// non-/api/auth requests, so CSRF would block legitimate refresh.
//
// WR-06 — Stateless refresh tokens (D-19): rotation here mints a NEW refresh
// token but does NOT invalidate the OLD one — both remain valid until their
// JWT exp (7d). This is the documented tradeoff: no `RefreshTokenRevocation`
// table, no per-token bookkeeping. Mitigations:
//   - 7-day TTL bounds the replay window
//   - tokenVersion bump on password change kicks ALL refresh tokens at once
//   - HttpOnly + Secure + SameSite=Strict cookies make exfil hard
// Stolen-refresh-token replay (within the 7-day window, before a password
// change) is OUT OF SCOPE for Phase 1. If the threat model changes, add
// per-jti revocation tracking and check it inside verifyRefreshToken.
export const runtime = 'nodejs';

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import {
  REFRESH_COOKIE_NAME,
  createAccessToken,
  createRefreshToken,
  setAuthCookies,
  setCsrfCookie,
  verifyRefreshToken,
} from '@/lib/server/auth';
import { acquireRefreshLock } from '@/lib/server/auth/refresh-lock';
import { prisma } from '@/lib/server/prisma';
import { makeRequestContext, withRequestContext } from '@/lib/server/observability/request-context';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = makeRequestContext(req.headers);
  return withRequestContext(ctx, async () => {
    const refreshCookie = req.cookies.get(REFRESH_COOKIE_NAME)?.value;
    if (!refreshCookie) {
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Refresh token missing.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const payload = await verifyRefreshToken(refreshCookie);
    if (!payload) {
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Refresh token invalid or expired.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, tokenVersion: true, status: true },
    });
    if (!user) {
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Account not found.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }
    if (user.tokenVersion !== payload.tokenVersion) {
      // D-19 — refresh post-password-change is rejected.
      return NextResponse.json(
        { error: 'INVALID_REFRESH', message: 'Session expired.' },
        { status: 401, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // D-ADMIN-02 — refuse SUSPENDED users on refresh. The refresh route is the
    // 15-min choke point: once we 403 here, the existing access JWT expires
    // within its 15-min TTL and the user is fully locked out without needing
    // to revoke per-token state.
    if (user.status === 'SUSPENDED') {
      return NextResponse.json(
        { error: 'ACCOUNT_SUSPENDED', message: 'This account has been suspended.' },
        { status: 403, headers: { 'x-request-id': ctx.requestId } },
      );
    }

    // D-20 — single-flight, best-effort. On contention (another refresh for
    // this user is in flight — common when the client has two tabs open),
    // back off briefly and retry a few times. If we STILL can't get the lock,
    // proceed WITHOUT it rather than 409: dual rotation is safe here because
    // refresh tokens are stateless (see the WR-06 note above) — the other
    // request's new token and ours both stay valid until their 7d exp. A hard
    // 409 just pushed the failure onto the client, which surfaced as a
    // spurious "session expired" mid-use.
    let release: (() => Promise<void>) | null = null;
    for (let attempt = 0; attempt < 4 && !release; attempt++) {
      release = await acquireRefreshLock(user.id);
      if (!release && attempt < 3) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    try {
      const accessToken = await createAccessToken({
        sub: user.id,
        email: user.email,
        tokenVersion: user.tokenVersion,
      });
      const refreshToken = await createRefreshToken(user.id, user.tokenVersion);
      await setAuthCookies(accessToken, refreshToken);
      await setCsrfCookie();
      return NextResponse.json(
        { ok: true },
        { status: 200, headers: { 'x-request-id': ctx.requestId } },
      );
    } finally {
      if (release) await release();
    }
  });
}
