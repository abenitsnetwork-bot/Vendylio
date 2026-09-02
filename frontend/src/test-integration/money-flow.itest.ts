// C1 scenario 1 — the money happy path, end to end, against a real database.
//
//   guest card checkout  → Stripe webhook (checkout.session.completed)
//     → Order PAID + stock ledger decrement + OrderStatusEvent + commission
//   replay the same webhook → deduped, no double effect
//   guest Cash App checkout → seller confirm-payment
//     → Order PAID + a CommissionCharge receivable (OWED)
//   owner withdrawal → the OWED commission is withheld (FIFO) → charge SETTLED
//   owner refunds the manual order → stock restocked + commission unwound
//
// Everything here runs for real: the Serializable transactions, the
// pg_advisory_xact_lock on the withdrawal, the FK graph, applyStockChange's
// ledger, the migration schema. Only Stripe's HTTP SDK is mocked.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// The orders route calls getProvider().charge / breaker.execute — mock the
// singleton so no real Stripe call is made. The webhook route is NOT mocked;
// it verifies the fixture's real HMAC signature.
vi.mock('@/lib/server/payments/provider-singleton', () => ({
  PaymentProviderUnconfiguredError: class extends Error {},
  getProvider: () => ({
    charge: vi.fn().mockResolvedValue({
      providerChargeId: 'cs_itest_card_1',
      paymentUrl: 'https://stripe.test/pay/cs_itest_card_1',
    }),
    chargeConnected: vi.fn().mockResolvedValue({
      providerChargeId: 'cs_itest_card_1',
      paymentUrl: 'https://stripe.test/pay/cs_itest_card_1',
    }),
  }),
  breaker: {
    execute: <T>(fn: () => Promise<T>) => fn(),
    snapshot: async () => 'closed',
    reset: async () => {},
  },
  __resetProviderSingleton: () => {},
}));

import { POST as ordersPOST } from '@/app/api/orders/route';
import { GET as withdrawalsGET, POST as withdrawalsPOST } from '@/app/api/withdrawals/route';
import { POST as webhookPOST } from '@/app/api/webhooks/stripe/route';
import { POST as confirmPaymentPOST } from '@/app/api/orders/[id]/confirm-payment/route';
import { POST as refundPOST } from '@/app/api/orders/[id]/refund/route';
import { stripeFixture } from '@/test-utils/stripe-mock';
import {
  prisma,
  truncate,
  disconnect,
  resetCookieJar,
  authAs,
  apiRequest,
  rawRequest,
  readJson,
  seedVerifiedUser,
  seedStore,
  seedProduct,
  seedPlatformSettings,
} from './harness';

let owner: { id: string; email: string };
let store: { id: string; slug: string; organizationId: string };
let product: { id: string; priceCents: number; quantity: number };

beforeAll(async () => {
  await truncate();
});
afterAll(async () => {
  await disconnect();
});

beforeEach(async () => {
  await truncate();
  resetCookieJar();
  await seedPlatformSettings(600); // 6%
  owner = await seedVerifiedUser();
  store = await seedStore(owner.id, { published: true, cashAppCashtag: 'ItestShop' });
  product = await seedProduct(store.id, { priceCents: 1800, quantity: 25 });
});

async function paidCardOrder(): Promise<{ id: string; amount: number }> {
  await authAs(owner);
  const res = await ordersPOST(
    apiRequest('/api/orders', {
      idempotencyKey: 'itest-card-1',
      body: {
        storeSlug: store.slug,
        items: [{ productId: product.id, quantity: 2 }],
        customerName: 'Buyer One',
        customerPhone: '+15551230000',
        customerEmail: 'buyer1@itest.dev',
        paymentMethod: 'card',
        fulfillmentMethod: 'pickup',
      },
    }),
  );
  expect(res.status).toBe(201);
  const body = await readJson(res);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: body.id as string } });
  expect(order.provider).toBe('stripe_platform');
  expect(order.status).toBe('PENDING');
  expect(order.providerChargeId).toBe('cs_itest_card_1');

  const fx = stripeFixture({
    type: 'checkout.session.completed',
    sessionId: 'cs_itest_card_1',
    amountTotal: order.amount,
    paymentStatus: 'paid',
    customerEmail: 'buyer1@itest.dev',
  });
  const hookRes = await webhookPOST(rawRequest('/api/webhooks/stripe', fx.rawBody, fx.headers));
  expect(hookRes.status).toBe(200);
  expect((await readJson(hookRes)).deduped).toBe(false);

  return { id: order.id, amount: order.amount };
}

describe('C1 — money flow (card + manual, webhook, withdrawal, refund)', () => {
  it('card checkout → webhook marks the order PAID and decrements stock via the ledger', async () => {
    const order = await paidCardOrder();

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe('PAID');
    expect(paid.paidAt).toBeInstanceOf(Date);
    expect(paid.commissionAmount).toBeGreaterThan(0);
    expect(paid.netAmount).toBe(paid.amount - (paid.commissionAmount ?? 0));

    const p = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.quantity).toBe(23);

    const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.reason).toBe('SALE');
    expect(movements[0]!.delta).toBe(-2);

    const events = await prisma.orderStatusEvent.findMany({ where: { orderId: order.id } });
    expect(events.map((e) => e.status)).toContain('PAID');
  });

  it('replaying the same webhook is deduped — no second stock decrement', async () => {
    const order = await paidCardOrder();

    const fx = stripeFixture({
      type: 'checkout.session.completed',
      sessionId: 'cs_itest_card_1',
      amountTotal: order.amount,
      paymentStatus: 'paid',
    });
    const replay = await webhookPOST(rawRequest('/api/webhooks/stripe', fx.rawBody, fx.headers));
    expect(replay.status).toBe(200);
    expect((await readJson(replay)).deduped).toBe(true);

    const p = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(p.quantity).toBe(23);
    expect(await prisma.stockMovement.count({ where: { productId: product.id } })).toBe(1);
  });

  it('Cash App checkout + seller confirm accrues an OWED CommissionCharge', async () => {
    await authAs(owner);
    const res = await ordersPOST(
      apiRequest('/api/orders', {
        idempotencyKey: 'itest-manual-1',
        body: {
          storeSlug: store.slug,
          items: [{ productId: product.id, quantity: 1 }],
          customerName: 'Buyer Two',
          customerPhone: '+15551230001',
          paymentMethod: 'cashapp',
          fulfillmentMethod: 'pickup',
        },
      }),
    );
    expect(res.status).toBe(201);
    const orderId = (await readJson(res)).id as string;
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).provider).toBe(
      'cashapp_manual',
    );

    const confirm = await confirmPaymentPOST(
      apiRequest('/api/orders/x/confirm-payment', { body: {} }),
      {
        params: Promise.resolve({ id: orderId }),
      },
    );
    expect(confirm.status).toBe(200);

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(paid.status).toBe('PAID');

    const cc = await prisma.commissionCharge.findFirstOrThrow({ where: { orderId } });
    expect(cc.status).toBe('OWED');
    expect(cc.kind).toBe('SALE');
    expect(cc.amountCents).toBeGreaterThan(0);
  });

  it('a withdrawal withholds the OWED Cash App commission (FIFO) and settles the charge', async () => {
    const card = await paidCardOrder();

    // manual order → OWED commission
    await authAs(owner);
    const manualRes = await ordersPOST(
      apiRequest('/api/orders', {
        idempotencyKey: 'itest-manual-2',
        body: {
          storeSlug: store.slug,
          items: [{ productId: product.id, quantity: 1 }],
          customerName: 'Buyer Three',
          customerPhone: '+15551230002',
          paymentMethod: 'cashapp',
          fulfillmentMethod: 'pickup',
        },
      }),
    );
    const manualId = (await readJson(manualRes)).id as string;
    await confirmPaymentPOST(apiRequest('/api/orders/x/confirm-payment', { body: {} }), {
      params: Promise.resolve({ id: manualId }),
    });

    const cc = await prisma.commissionCharge.findFirstOrThrow({ where: { orderId: manualId } });
    const cardNet =
      (await prisma.order.findUniqueOrThrow({ where: { id: card.id } })).netAmount ?? 0;

    // GET reflects base balance minus the OWED commission.
    const listRes = await withdrawalsGET(apiRequest('/api/withdrawals'));
    const list = await readJson(listRes);
    expect(list.commissionOwedCents).toBe(cc.amountCents);
    expect(list.availableCents).toBe(cardNet - cc.amountCents);

    // Request a net payout that leaves room for the withheld commission.
    const netRequested = 500;
    const wRes = await withdrawalsPOST(
      apiRequest('/api/withdrawals', {
        body: {
          amount: netRequested,
          destination: { method: 'CASH_APP', cashtag: '$ItestPayout' },
        },
      }),
    );
    expect(wRes.status).toBe(201);
    const w = await readJson(wRes);
    expect(w.commissionSettledCents).toBe(cc.amountCents);
    expect(w.grossAmount).toBe(netRequested + cc.amountCents);

    const settled = await prisma.commissionCharge.findUniqueOrThrow({ where: { id: cc.id } });
    expect(settled.status).toBe('SETTLED');
    expect(settled.settledByWithdrawalId).toBeTruthy();
  });

  it('refunding a paid manual order restocks inventory and unwinds the commission', async () => {
    await authAs(owner);
    const manualRes = await ordersPOST(
      apiRequest('/api/orders', {
        idempotencyKey: 'itest-manual-3',
        body: {
          storeSlug: store.slug,
          items: [{ productId: product.id, quantity: 3 }],
          customerName: 'Buyer Four',
          customerPhone: '+15551230003',
          customerEmail: 'buyer4@itest.dev',
          paymentMethod: 'cashapp',
          fulfillmentMethod: 'pickup',
        },
      }),
    );
    const manualId = (await readJson(manualRes)).id as string;
    await confirmPaymentPOST(apiRequest('/api/orders/x/confirm-payment', { body: {} }), {
      params: Promise.resolve({ id: manualId }),
    });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      22,
    );

    const refundRes = await refundPOST(apiRequest('/api/orders/x/refund', { body: {} }), {
      params: Promise.resolve({ id: manualId }),
    });
    expect(refundRes.status).toBe(200);

    const refunded = await prisma.order.findUniqueOrThrow({ where: { id: manualId } });
    expect(refunded.status).toBe('REFUNDED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).quantity).toBe(
      25,
    );

    // The still-OWED sale charge is WAIVED on refund (not yet settled here).
    const charges = await prisma.commissionCharge.findMany({ where: { orderId: manualId } });
    expect(charges.some((c) => c.status === 'WAIVED' || c.kind === 'REFUND_CREDIT')).toBe(true);
  });
});
