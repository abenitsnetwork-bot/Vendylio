// C1 scenario 2 — the concurrent-withdrawal race.
//
// Two POST /api/withdrawals for the same user, fired together, against a real
// database with a real connection_limit=1 pool. The pg_advisory_xact_lock +
// Serializable transaction in the route must serialize them so the second
// attempt sees the first's PENDING reservation and is rejected. Exactly one
// row may be created. This is the test that would have caught the P2028
// deadlock fixed in 1a5925a (computeBalance must reuse the tx connection).
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

import { POST as withdrawalsPOST } from '@/app/api/withdrawals/route';
import {
  prisma,
  truncate,
  disconnect,
  resetCookieJar,
  authAs,
  apiRequest,
  readJson,
  seedVerifiedUser,
  seedStore,
} from './harness';

let owner: { id: string; email: string };
let store: { id: string; slug: string; organizationId: string };

beforeAll(async () => {
  await truncate();
});
afterAll(async () => {
  await disconnect();
});

beforeEach(async () => {
  await truncate();
  resetCookieJar();
  owner = await seedVerifiedUser();
  store = await seedStore(owner.id, { published: true });
  // A single earned, withdrawable sale worth $50.00 net.
  await prisma.order.create({
    data: {
      storeId: store.id,
      amount: 5000,
      netAmount: 5000,
      commissionAmount: 0,
      currency: 'USD',
      status: 'PAID',
      provider: 'stripe_platform',
      paidAt: new Date(),
      subtotalCents: 5000,
      deliveryFeeCents: 0,
      taxCents: 0,
      fulfillmentMethod: 'PICKUP',
      customerName: 'Buyer',
      customerPhone: '+15550000000',
      lineItems: [],
      idempotencyKey: `seed-${owner.id}`,
      idempotencyBodyHash: 'seed',
      trackingToken: `tok-${owner.id}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
});

function requestWithdrawal(amount: number) {
  return withdrawalsPOST(
    apiRequest('/api/withdrawals', {
      body: { amount, destination: { method: 'CASH_APP', cashtag: '$RacePayout' } },
    }),
  );
}

describe('C1 — concurrent withdrawal race', () => {
  it('serializes two overlapping requests — only one succeeds', async () => {
    await authAs(owner);

    // Each wants $40 net; the balance only covers one.
    const [a, b] = await Promise.all([requestWithdrawal(4000), requestWithdrawal(4000)]);
    const statuses = [a.status, b.status].sort();

    // One 201; the other is INSUFFICIENT_BALANCE (400) or, on a rare
    // serialization abort, TRANSIENT_CONFLICT (409).
    expect(statuses).toContain(201);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    const loser = a.status === 201 ? b : a;
    expect([400, 409]).toContain(loser.status);
    if (loser.status === 400) {
      expect((await readJson(loser)).code).toBe('INSUFFICIENT_BALANCE');
    }

    // The invariant that matters: never two reservations.
    expect(await prisma.withdrawal.count({ where: { userId: owner.id } })).toBe(1);
  });

  it('a second withdrawal after the first still respects the remaining balance', async () => {
    await authAs(owner);

    const first = await requestWithdrawal(3000);
    expect(first.status).toBe(201);

    // $30 already reserved of $50 — a $30 follow-up must fail.
    const second = await requestWithdrawal(3000);
    expect(second.status).toBe(400);
    expect((await readJson(second)).code).toBe('INSUFFICIENT_BALANCE');

    expect(await prisma.withdrawal.count({ where: { userId: owner.id } })).toBe(1);
  });
});
