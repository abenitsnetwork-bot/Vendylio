import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/server/auth', () => ({ hashPassword: vi.fn(async () => 'hashed') }));
vi.mock('@/lib/server/auth/banned-passwords', () => ({
  isBanned: (p: string) => p === 'password',
}));

import { claimInviteWithNewAccount } from './claim';

const now = new Date('2026-09-01T00:00:00Z');
const good = 'correct-horse-battery';

const txMock = {
  teamInvite: {
    findUnique: prismaMock.teamInvite.findUnique,
    update: prismaMock.teamInvite.update,
  },
  user: { create: prismaMock.user.create },
  organizationMember: { create: prismaMock.organizationMember.create },
};

function pendingInvite(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    organizationId: 'org1',
    email: 'New@X.com',
    role: 'MEMBER',
    status: 'PENDING',
    expiresAt: new Date('2026-09-08T00:00:00Z'),
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  (
    prismaMock.$transaction as unknown as { mockImplementation: (f: unknown) => void }
  ).mockImplementation((fn: (tx: unknown) => unknown) => fn(txMock));
});

describe('claimInviteWithNewAccount', () => {
  it('rejects a banned or too-short password before any DB work', async () => {
    expect(
      await claimInviteWithNewAccount(prismaMock, { token: 't-token', password: 'password', now }),
    ).toEqual({ ok: false, code: 'PASSWORD_BANNED' });
    expect(
      await claimInviteWithNewAccount(prismaMock, { token: 't-token', password: 'short', now }),
    ).toEqual({ ok: false, code: 'PASSWORD_TOO_SHORT' });
    expect(prismaMock.teamInvite.findUnique).not.toHaveBeenCalled();
  });

  it('404s an unknown token', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce(null);
    expect(
      await claimInviteWithNewAccount(prismaMock, { token: 't-token', password: good, now }),
    ).toEqual({ ok: false, code: 'INVITE_NOT_FOUND' });
  });

  it('refuses when an account already exists for the invite email', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce(pendingInvite());
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing' } as never);
    expect(
      await claimInviteWithNewAccount(prismaMock, { token: 't-token', password: good, now }),
    ).toEqual({ ok: false, code: 'ACCOUNT_EXISTS' });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('creates a verified account + membership + marks the invite accepted', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce(pendingInvite());
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce(pendingInvite()); // in-tx re-check
    prismaMock.user.create.mockResolvedValueOnce({
      id: 'u1',
      email: 'new@x.com',
      tokenVersion: 0,
    } as never);

    const res = await claimInviteWithNewAccount(prismaMock, {
      token: 't-token',
      password: good,
      now,
    });

    expect(res).toEqual({
      ok: true,
      userId: 'u1',
      email: 'new@x.com',
      tokenVersion: 0,
      role: 'MEMBER',
    });
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@x.com', emailVerifiedAt: now }),
      }),
    );
    expect(prismaMock.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: 'org1', userId: 'u1', role: 'MEMBER' },
    });
    expect(prismaMock.teamInvite.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'ACCEPTED', acceptedAt: now },
    });
  });

  it('maps a unique-email race (P2002) to ACCOUNT_EXISTS', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce(pendingInvite());
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce(pendingInvite());
    prismaMock.user.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 'P2002' }),
    );

    expect(
      await claimInviteWithNewAccount(prismaMock, { token: 't-token', password: good, now }),
    ).toEqual({ ok: false, code: 'ACCOUNT_EXISTS' });
  });
});
