import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { seedAdmin } from '@/test-utils/admin-fixtures';

vi.mock('@/lib/server/middleware', () => ({ requireSuperadmin: vi.fn() }));
vi.mock('@/lib/server/middleware/rate-limit-by-userid', () => ({
  enforceAdminRateLimit: vi.fn(),
}));
vi.mock('@/lib/server/admin/audit', () => ({ logAdminAction: vi.fn() }));
const { recordSuccess } = vi.hoisted(() => ({ recordSuccess: vi.fn() }));
vi.mock('@/lib/server/auth/lockout', () => ({ recordSuccess }));

import { requireSuperadmin } from '@/lib/server/middleware';
import { enforceAdminRateLimit } from '@/lib/server/middleware/rate-limit-by-userid';
import { logAdminAction } from '@/lib/server/admin/audit';
import { POST } from './route';

const admin = seedAdmin({ id: 'super_actor' });
const superCtx = {
  user: { sub: admin.id, email: admin.email },
  admin: { id: admin.id, email: admin.email, role: 'SUPERADMIN' as const },
};

function makeReq(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'tok';
  return new NextRequest('http://test/api/admin/users/u1/temp-password', {
    method: 'POST',
    headers,
  });
}
const ctxWith = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSuperadmin).mockResolvedValue(superCtx as never);
  vi.mocked(enforceAdminRateLimit).mockResolvedValue(null as never);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u1',
    email: 'merchant@shop.com',
    role: 'USER',
    passwordHash: 'old-hash',
  } as never);
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
  prismaMock.user.update.mockResolvedValue({ id: 'u1' } as never);
});

describe('POST /api/admin/users/[id]/temp-password', () => {
  it('403s without CSRF', async () => {
    expect((await POST(makeReq('missing'), ctxWith('u1'))).status).toBe(403);
  });

  it('403s an ADMIN (requireSuperadmin bails)', async () => {
    vi.mocked(requireSuperadmin).mockResolvedValueOnce(
      NextResponse.json({ error: 'ADMIN_REQUIRED' }, { status: 403 }) as never,
    );
    expect((await POST(makeReq(), ctxWith('u1'))).status).toBe(403);
  });

  it('404s USER_NOT_FOUND', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq(), ctxWith('nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('USER_NOT_FOUND');
  });

  it('issues a password, bumps tokenVersion, forces a change, audits (no password in metadata)', async () => {
    const res = await POST(makeReq(), ctxWith('u1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.tempPassword).toBe('string');
    expect(body.tempPassword.length).toBeGreaterThanOrEqual(16);
    expect(body.email).toBe('merchant@shop.com');

    const updateArg = prismaMock.user.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.tokenVersion).toEqual({ increment: 1 });
    expect(updateArg.data.mustChangePassword).toBe(true);
    expect(typeof updateArg.data.passwordHash).toBe('string');
    expect(updateArg.data.passwordHash).not.toBe(body.tempPassword); // hashed, not plaintext

    const auditArg = vi.mocked(logAdminAction).mock.calls[0]?.[1];
    expect(auditArg).toMatchObject({ action: 'user.temp_password', targetId: 'u1' });
    expect(JSON.stringify(auditArg?.metadata)).not.toContain(body.tempPassword);

    expect(recordSuccess).toHaveBeenCalledWith('merchant@shop.com');
  });
});
