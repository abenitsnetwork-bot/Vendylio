import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveOwnStore } from './org';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveOwnStore', () => {
  it('returns null when the user has no organization membership', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue(null);
    const store = await resolveOwnStore('user-1');
    expect(store).toBeNull();
    expect(prismaMock.store.findUnique).not.toHaveBeenCalled();
  });

  it("resolves the member's organization's store", async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue({
      id: 'mem-1',
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'OWNER',
      createdAt: new Date(),
    } as never);
    prismaMock.store.findUnique.mockResolvedValue({
      id: 'store-1',
      organizationId: 'org-1',
    } as never);

    const store = await resolveOwnStore('user-1');
    expect(store?.id).toBe('store-1');
    expect(prismaMock.organizationMember.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(prismaMock.store.findUnique).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
    });
  });

  it('returns null when the membership has no store yet', async () => {
    prismaMock.organizationMember.findFirst.mockResolvedValue({
      id: 'mem-1',
      organizationId: 'org-1',
      userId: 'user-1',
      role: 'OWNER',
      createdAt: new Date(),
    } as never);
    prismaMock.store.findUnique.mockResolvedValue(null);

    const store = await resolveOwnStore('user-1');
    expect(store).toBeNull();
  });
});
