import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  canGrantRole,
  isInvitableRole,
  normalizeInviteEmail,
  generateInviteToken,
  inviteUrl,
  acceptInvite,
} from './invites';

describe('pure helpers', () => {
  it('isInvitableRole rejects OWNER', () => {
    expect(isInvitableRole('ADMIN')).toBe(true);
    expect(isInvitableRole('MEMBER')).toBe(true);
    expect(isInvitableRole('OWNER')).toBe(false);
  });

  it('canGrantRole enforces strictly-lower rank', () => {
    expect(canGrantRole('OWNER', 'ADMIN')).toBe(true);
    expect(canGrantRole('OWNER', 'MEMBER')).toBe(true);
    expect(canGrantRole('ADMIN', 'MEMBER')).toBe(true);
    expect(canGrantRole('ADMIN', 'ADMIN')).toBe(false);
    expect(canGrantRole('MEMBER', 'MEMBER')).toBe(false);
  });

  it('normalizeInviteEmail lowercases + trims', () => {
    expect(normalizeInviteEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('generateInviteToken is url-safe and long', () => {
    const t = generateInviteToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThan(20);
  });

  it('inviteUrl points at /team/accept with the token', () => {
    expect(inviteUrl('abc123')).toContain('/team/accept?token=abc123');
  });
});

describe('acceptInvite', () => {
  const now = new Date('2026-09-01T00:00:00Z');
  const txMock = {
    teamInvite: {
      findUnique: prismaMock.teamInvite.findUnique,
      update: prismaMock.teamInvite.update,
    },
    organizationMember: {
      findFirst: prismaMock.organizationMember.findFirst,
      create: prismaMock.organizationMember.create,
    },
  };

  beforeEach(() => {
    (
      prismaMock.$transaction as unknown as { mockImplementation: (f: unknown) => void }
    ).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fn: any) => fn(txMock),
    );
  });

  it('creates a membership + marks the invite ACCEPTED on the happy path', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce({
      id: 'i1',
      organizationId: 'org1',
      email: 'new@x.com',
      role: 'MEMBER',
      status: 'PENDING',
      expiresAt: new Date('2026-09-08T00:00:00Z'),
    } as never);
    prismaMock.organizationMember.findFirst.mockResolvedValueOnce(null);

    const res = await acceptInvite(prismaMock, {
      token: 't',
      userId: 'u1',
      userEmail: 'NEW@x.com',
      now,
    });

    expect(res).toEqual({ ok: true, organizationId: 'org1', role: 'MEMBER' });
    expect(prismaMock.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: 'org1', userId: 'u1', role: 'MEMBER' },
    });
    expect(prismaMock.teamInvite.update).toHaveBeenCalledWith({
      where: { id: 'i1' },
      data: { status: 'ACCEPTED', acceptedAt: now },
    });
  });

  it('rejects a token whose email does not match the user', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce({
      id: 'i1',
      organizationId: 'org1',
      email: 'invited@x.com',
      role: 'MEMBER',
      status: 'PENDING',
      expiresAt: new Date('2026-09-08T00:00:00Z'),
    } as never);

    const res = await acceptInvite(prismaMock, {
      token: 't',
      userId: 'u1',
      userEmail: 'someone-else@x.com',
      now,
    });
    expect(res).toEqual({ ok: false, code: 'EMAIL_MISMATCH' });
    expect(prismaMock.organizationMember.create).not.toHaveBeenCalled();
  });

  it('rejects an expired invite', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce({
      id: 'i1',
      organizationId: 'org1',
      email: 'new@x.com',
      role: 'MEMBER',
      status: 'PENDING',
      expiresAt: new Date('2026-08-01T00:00:00Z'),
    } as never);
    const res = await acceptInvite(prismaMock, {
      token: 't',
      userId: 'u1',
      userEmail: 'new@x.com',
      now,
    });
    expect(res).toEqual({ ok: false, code: 'INVITE_EXPIRED' });
  });

  it('rejects a user who already belongs to another org', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce({
      id: 'i1',
      organizationId: 'org1',
      email: 'new@x.com',
      role: 'MEMBER',
      status: 'PENDING',
      expiresAt: new Date('2026-09-08T00:00:00Z'),
    } as never);
    prismaMock.organizationMember.findFirst.mockResolvedValueOnce({
      organizationId: 'other-org',
    } as never);

    const res = await acceptInvite(prismaMock, {
      token: 't',
      userId: 'u1',
      userEmail: 'new@x.com',
      now,
    });
    expect(res).toEqual({ ok: false, code: 'ALREADY_IN_ORG' });
  });

  it('is idempotent when the user is already in this org', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce({
      id: 'i1',
      organizationId: 'org1',
      email: 'new@x.com',
      role: 'ADMIN',
      status: 'PENDING',
      expiresAt: new Date('2026-09-08T00:00:00Z'),
    } as never);
    prismaMock.organizationMember.findFirst.mockResolvedValueOnce({
      organizationId: 'org1',
    } as never);

    const res = await acceptInvite(prismaMock, {
      token: 't',
      userId: 'u1',
      userEmail: 'new@x.com',
      now,
    });
    expect(res).toEqual({ ok: true, organizationId: 'org1', role: 'ADMIN' });
    expect(prismaMock.organizationMember.create).not.toHaveBeenCalled();
  });

  it('404s an unknown token', async () => {
    prismaMock.teamInvite.findUnique.mockResolvedValueOnce(null);
    const res = await acceptInvite(prismaMock, {
      token: 'nope',
      userId: 'u1',
      userEmail: 'x@x.com',
      now,
    });
    expect(res).toEqual({ ok: false, code: 'INVITE_NOT_FOUND' });
  });
});
