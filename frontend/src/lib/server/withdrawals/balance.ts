import type { PrismaClient } from '@prisma/client';
import type { TxClient } from './lock';
import { resolveOwnStore } from '../org';

/**
 * Compute a user's withdrawable balance. The optional `tx` argument lets the
 * caller bind the read to an open transaction — required for race-free
 * withdrawal flow (see backend/src/routes/withdrawals.ts and
 * backend/src/lib/withdrawals/lock.ts).
 *
 * When `tx` is omitted, the read happens against the default Prisma client
 * with no isolation guarantee — fine for read-only callers (dashboards,
 * "your balance" widgets) that don't need consistency with concurrent
 * withdrawal writes.
 */
export interface BalanceComputer {
  (userId: string, tx?: TxClient): Promise<number>;
}

/**
 * Default balance formula for the Vendylio marketplace:
 *   balance = sum(PAID stripe_platform Orders.netAmount or amount FOR THE SELLER'S STORE)
 *             - sum(non-cancelled Withdrawals.amount)
 *
 * Phase 2 fix: earnings are scoped by the caller's Store (resolved via
 * `resolveOwnStore`), not by `Order.userId` — the buyer and the seller are
 * different people now that checkout is guest-first (Order.userId is the
 * *buyer*, often null). Summing by buyer identity would have given every
 * seller a $0 balance forever. `withdrawals` still key off `userId` — those
 * are the seller's own withdrawal requests, unaffected by the buyer/seller
 * split.
 *
 * Phase 3 security requirement — `provider: 'stripe_platform'` filter:
 * a Store connected to Stripe Connect (ACTIVE) routes some/all of its sales
 * as `stripe_connect` destination charges, whose money lands directly on
 * the seller's own Stripe account — it never touches Vendylio's balance at
 * all. Including those orders here would let a connected seller withdraw
 * the same sale a SECOND time manually (once already paid out by Stripe,
 * once again via this manual withdrawal system). Only `stripe_platform`
 * orders (money held by Vendylio, awaiting manual payout) count.
 *
 * Projects with different earning models (e.g., subscription apps, vested earnings,
 * external ledgers) can swap this out by setting `app.locals.computeBalance` to their own
 * BalanceComputer in `backend/src/index.ts`.
 *
 * Returns the balance in smallest currency unit (integer). Always >= 0.
 */
export function createDefaultBalanceComputer(prisma: PrismaClient): BalanceComputer {
  return async function computeBalance(userId: string, tx?: TxClient): Promise<number> {
    const client: PrismaClient | TxClient = tx ?? prisma;

    // Store identity is stable (doesn't change mid-withdrawal), so this read
    // is safe to run outside the caller's transaction even when `tx` is set —
    // only the financial aggregates below need the transactional snapshot.
    const store = await resolveOwnStore(userId);

    const [orders, withdrawals] = await Promise.all([
      store
        ? client.order.findMany({
            where: { storeId: store.id, status: 'PAID', provider: 'stripe_platform' },
            select: { amount: true, netAmount: true },
          })
        : Promise.resolve([]),
      client.withdrawal.findMany({
        where: { userId, status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] } },
        select: { amount: true },
      }),
    ]);

    const earned = orders.reduce((sum, o) => sum + (o.netAmount ?? o.amount), 0);
    const reserved = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    return Math.max(0, earned - reserved);
  };
}
