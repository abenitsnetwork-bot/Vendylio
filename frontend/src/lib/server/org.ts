// Resolves the caller's own Store through their Organization membership.
// Phase 1 (Organization multi-tenancy) replaced `Store.userId` with
// `Store.organizationId` — every route that used to do
// `prisma.store.findUnique({ where: { userId } })` must go through here
// instead, since a Store is no longer looked up by user directly.
//
// One member per Organization for the MVP (no team invites yet), so the
// caller's first membership row is unambiguous.
import 'server-only';
import { prisma } from '@/lib/server/prisma';
import type { Store } from '@prisma/client';

export async function resolveOwnStore(userId: string): Promise<Store | null> {
  const membership = await prisma.organizationMember.findFirst({ where: { userId } });
  if (!membership) return null;
  return prisma.store.findUnique({ where: { organizationId: membership.organizationId } });
}
