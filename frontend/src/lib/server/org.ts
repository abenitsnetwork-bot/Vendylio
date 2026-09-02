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
import type { TxClient } from '@/lib/server/withdrawals/lock';

/**
 * `client` lets a caller already inside an interactive transaction reuse that
 * transaction's connection. Passing the standalone `prisma` while a
 * `$transaction` holds the pool (DATABASE_URL runs `connection_limit=1` on
 * Neon) deadlocks the second query until the tx times out — so
 * `balance.ts` (which runs inside the withdrawals Serializable tx) passes `tx`
 * here. Plain route handlers omit it and hit the base client as before.
 */
export async function resolveOwnStore(
  userId: string,
  client: Pick<typeof prisma, 'organizationMember' | 'store'> | TxClient = prisma,
): Promise<Store | null> {
  const db = client as typeof prisma;
  const membership = await db.organizationMember.findFirst({ where: { userId } });
  if (!membership) return null;
  return db.store.findUnique({ where: { organizationId: membership.organizationId } });
}
