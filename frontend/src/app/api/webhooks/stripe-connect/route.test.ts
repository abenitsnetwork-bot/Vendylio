import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { NextRequest } from 'next/server';

const webhookLogFindUnique = vi.fn();
const webhookLogCreate = vi.fn();
const webhookLogUpdate = vi.fn();
const storeFindUnique = vi.fn();
const storeUpdate = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
  fn({
    webhookLog: {
      findUnique: webhookLogFindUnique,
      create: webhookLogCreate,
      update: webhookLogUpdate,
    },
    store: { findUnique: storeFindUnique, update: storeUpdate },
  }),
);

vi.mock('@/lib/server/prisma', () => ({
  prisma: { $transaction },
}));

const SECRET = 'test-connect-webhook-secret';

function accountEvent(opts: {
  accountId?: string;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  eventId?: string;
}) {
  const event = {
    id: opts.eventId ?? 'evt_connect_1',
    object: 'event',
    type: 'account.updated',
    account: opts.accountId ?? 'acct_1',
    data: {
      object: {
        id: opts.accountId ?? 'acct_1',
        object: 'account',
        charges_enabled: opts.chargesEnabled ?? false,
        payouts_enabled: opts.payoutsEnabled ?? false,
      },
    },
  };
  const payload = JSON.stringify(event);
  const stripe = new Stripe('sk_test_fixture');
  const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const req = new NextRequest('http://localhost/api/webhooks/stripe-connect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: Buffer.from(payload) as unknown as BodyInit,
  });
  return { req, event };
}

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fixture');
  vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', SECRET);
  webhookLogFindUnique.mockReset().mockResolvedValue(null);
  webhookLogCreate.mockReset();
  webhookLogUpdate.mockReset();
  storeFindUnique.mockReset();
  storeUpdate.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/webhooks/stripe-connect', () => {
  it('sets the Store ACTIVE once both capabilities are enabled', async () => {
    storeFindUnique.mockResolvedValueOnce({
      id: 'store-1',
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'PENDING',
    });
    const { POST } = await import('./route');
    const { req } = accountEvent({ chargesEnabled: true, payoutsEnabled: true });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { stripeOnboardingStatus: 'ACTIVE' },
    });
  });

  it('does NOT flip PENDING to RESTRICTED mid-onboarding (capabilities not yet enabled)', async () => {
    storeFindUnique.mockResolvedValueOnce({
      id: 'store-1',
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'PENDING',
    });
    const { POST } = await import('./route');
    const { req } = accountEvent({ chargesEnabled: false, payoutsEnabled: false });
    await POST(req);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('downgrades a previously ACTIVE store to RESTRICTED when a capability is lost', async () => {
    storeFindUnique.mockResolvedValueOnce({
      id: 'store-1',
      stripeAccountId: 'acct_1',
      stripeOnboardingStatus: 'ACTIVE',
    });
    const { POST } = await import('./route');
    const { req } = accountEvent({ chargesEnabled: false, payoutsEnabled: true });
    await POST(req);
    expect(storeUpdate).toHaveBeenCalledWith({
      where: { id: 'store-1' },
      data: { stripeOnboardingStatus: 'RESTRICTED' },
    });
  });

  it('is a no-op for an unknown account id (no matching Store)', async () => {
    storeFindUnique.mockResolvedValueOnce(null);
    const { POST } = await import('./route');
    const { req } = accountEvent({ chargesEnabled: true, payoutsEnabled: true });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(storeUpdate).not.toHaveBeenCalled();
  });

  it('rejects a tampered/incorrectly-signed body with 401', async () => {
    const { req } = accountEvent({ chargesEnabled: true, payoutsEnabled: true });
    const tamperedBody = Buffer.from(JSON.stringify({ id: 'evt_tampered' }));
    const tamperedReq = new NextRequest('http://localhost/api/webhooks/stripe-connect', {
      method: 'POST',
      headers: req.headers,
      body: tamperedBody as unknown as BodyInit,
    });
    const { POST } = await import('./route');
    const res = await POST(tamperedReq);
    expect(res.status).toBe(401);
  });

  it('exports runtime=nodejs and dynamic=force-dynamic', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
