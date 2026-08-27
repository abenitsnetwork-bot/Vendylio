// Phase 2 tests for POST /api/orders (guest checkout).
//
// Bootstrap (mirrors the pre-Phase-0 Bictorys orders route test's pattern):
//   - prisma-mock first (auto-hoists vi.mock for '@/lib/server/prisma')
//   - vi.mock('@/lib/server/middleware') so optionalAuth is per-test controllable
//   - vi.mock('@/lib/server/payments/provider-singleton') so getProvider()
//     returns a stub PaymentProvider instead of reading STRIPE_* env
import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

function fingerprintBody(input: {
  storeId: string;
  items: { productId: string; quantity: number; variantId?: string }[];
}) {
  const sortedItems = [...input.items]
    .map((i) => ({ productId: i.productId, quantity: i.quantity, variantId: i.variantId ?? null }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
  const canonical = JSON.stringify({ storeId: input.storeId, items: sortedItems });
  return createHash('sha256').update(canonical).digest('hex');
}

vi.mock('@/lib/server/middleware', () => ({
  optionalAuth: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/server/org', () => ({
  resolveOwnStore: vi.fn(),
}));

vi.mock('@/lib/server/payments/provider-singleton', () => ({
  getProvider: vi.fn(),
  breaker: { execute: vi.fn() },
  PaymentProviderUnconfiguredError: class PaymentProviderUnconfiguredError extends Error {
    constructor() {
      super('Payment provider not configured');
      this.name = 'PaymentProviderUnconfiguredError';
    }
  },
  __resetProviderSingleton: vi.fn(),
}));

import { optionalAuth, requireAuth } from '@/lib/server/middleware';
import { resolveOwnStore } from '@/lib/server/org';
import {
  getProvider,
  breaker,
  PaymentProviderUnconfiguredError,
} from '@/lib/server/payments/provider-singleton';
import { CircuitOpenError } from '@/lib/server/payments/circuit-breaker';
import { POST, GET } from './route';

const mockOptionalAuth = vi.mocked(optionalAuth);
const mockRequireAuth = vi.mocked(requireAuth);
const mockResolveOwnStore = vi.mocked(resolveOwnStore);
const mockGetProvider = vi.mocked(getProvider);
const mockExecute = vi.mocked(breaker.execute);

const STORE = {
  id: 'store-1',
  slug: 'shea-store',
  published: true,
  stripeAccountId: null,
  stripeOnboardingStatus: 'NOT_STARTED',
  deliveryFeeCents: 0,
};
const PRODUCT_A = {
  id: 'prod-a',
  storeId: 'store-1',
  name: 'Shea Butter',
  priceCents: 1800,
  quantity: 10,
  unit: 'UNIT',
  status: 'ACTIVE',
  variants: [],
};

interface MakePostOpts {
  idempotencyKey?: string | null;
  csrf?: 'match' | 'missing';
}

function makePost(body: unknown, opts: MakePostOpts = {}): NextRequest {
  const csrf = opts.csrf ?? 'match';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') {
    headers['x-csrf-token'] = 'any-nonempty-value';
  }
  if (opts.idempotencyKey !== null) {
    headers['idempotency-key'] = opts.idempotencyKey ?? 'idem-key-1';
  }
  return new NextRequest('http://test/api/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const validBody = {
  storeSlug: 'shea-store',
  items: [{ productId: 'prod-a', quantity: 2 }],
  customerName: 'Amara',
  customerPhone: '+15551234567',
};

function seededOrder(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order_seed_1',
    storeId: 'store-1',
    userId: null,
    amount: 3600,
    currency: 'USD',
    status: 'PENDING',
    subtotalCents: 3600,
    deliveryFeeCents: 0,
    taxCents: 0,
    customerEmail: null,
    customerPhone: '+15551234567',
    customerName: 'Amara',
    deliveryAddress: null,
    lineItems: [{ productId: 'prod-a', name: 'Shea Butter', priceCents: 1800, quantity: 2 }],
    idempotencyKey: 'idem-key-1',
    idempotencyBodyHash: fingerprintBody({
      storeId: 'store-1',
      items: [{ productId: 'prod-a', quantity: 2 }],
    }),
    provider: 'stripe_platform',
    providerChargeId: null,
    paymentUrl: null,
    paymentMethod: null,
    commissionAmount: null,
    netAmount: null,
    expiresAt: new Date('2026-05-09T12:00:00Z'),
    paidAt: null,
    createdAt: new Date('2026-05-08T12:00:00Z'),
    updatedAt: new Date('2026-05-08T12:00:00Z'),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOptionalAuth.mockResolvedValue(null);
  prismaMock.store.findFirst.mockResolvedValue(STORE as never);
  prismaMock.product.findMany.mockResolvedValue([PRODUCT_A] as never);
  prismaMock.order.findUnique.mockResolvedValue(null as never);
  mockGetProvider.mockReturnValue({
    name: 'stripe',
    charge: vi.fn(async () => ({
      providerChargeId: 'cs_test_1',
      paymentUrl: 'https://checkout.stripe.com/pay/cs_test_1',
      status: 'PENDING' as const,
    })),
    chargeConnected: vi.fn(async () => ({
      providerChargeId: 'cs_connect_1',
      paymentUrl: 'https://checkout.stripe.com/pay/cs_connect_1',
      status: 'PENDING' as const,
    })),
  } as never);
  mockExecute.mockImplementation(async (fn) => fn());
});

describe('POST /api/orders — guards', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost(validBody, { csrf: 'missing' }));
    expect(res.status).toBe(403);
    expect(prismaMock.store.findFirst).not.toHaveBeenCalled();
  });

  it('400s IDEMPOTENCY_KEY_REQUIRED when header missing', async () => {
    const res = await POST(makePost(validBody, { idempotencyKey: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('400s IDEMPOTENCY_KEY_INVALID when key exceeds 200 chars', async () => {
    const res = await POST(makePost(validBody, { idempotencyKey: 'x'.repeat(201) }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('400s VALIDATION_FAILED on an empty cart', async () => {
    const res = await POST(makePost({ ...validBody, items: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('404s STORE_NOT_FOUND for an unknown or unpublished slug', async () => {
    prismaMock.store.findFirst.mockResolvedValue(null);
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('STORE_NOT_FOUND');
  });
});

describe('POST /api/orders — pricing guards (server re-prices, never trusts the client)', () => {
  it('400s PRODUCT_UNAVAILABLE when a product does not belong to the store / is archived', async () => {
    prismaMock.product.findMany.mockResolvedValue([]);
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PRODUCT_UNAVAILABLE');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('400s PRODUCT_UNAVAILABLE when requested quantity exceeds stock', async () => {
    prismaMock.product.findMany.mockResolvedValue([{ ...PRODUCT_A, quantity: 1 }] as never);
    const res = await POST(makePost(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PRODUCT_UNAVAILABLE');
  });
});

describe('POST /api/orders — variant-aware pricing (Phase 7)', () => {
  const VARIANT = {
    id: 'var-1',
    productId: 'prod-a',
    name: 'Size',
    value: 'Large',
    priceDeltaCents: 200,
    quantity: 3,
  };
  const PRODUCT_WITH_VARIANTS = { ...PRODUCT_A, variants: [VARIANT] };

  it('400s PRODUCT_UNAVAILABLE when the product has variants but none was selected', async () => {
    prismaMock.product.findMany.mockResolvedValue([PRODUCT_WITH_VARIANTS] as never);
    const res = await POST(makePost(validBody)); // no variantId on the item
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PRODUCT_UNAVAILABLE');
  });

  it("400s PRODUCT_UNAVAILABLE when the given variantId doesn't belong to the product", async () => {
    prismaMock.product.findMany.mockResolvedValue([PRODUCT_WITH_VARIANTS] as never);
    const res = await POST(
      makePost({
        ...validBody,
        items: [{ productId: 'prod-a', quantity: 2, variantId: 'not-a-real-variant' }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it('checks stock against the variant quantity, not the base product quantity', async () => {
    prismaMock.product.findMany.mockResolvedValue([PRODUCT_WITH_VARIANTS] as never);
    const res = await POST(
      makePost({
        ...validBody,
        items: [{ productId: 'prod-a', quantity: 5, variantId: 'var-1' }], // variant only has 3
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain('Only 3');
  });

  it('prices the line at base + variant delta and snapshots variantId/variantLabel/unit', async () => {
    prismaMock.product.findMany.mockResolvedValue([PRODUCT_WITH_VARIANTS] as never);
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    prismaMock.order.update.mockResolvedValue(seededOrder() as never);

    await POST(
      makePost({
        ...validBody,
        items: [{ productId: 'prod-a', quantity: 2, variantId: 'var-1' }],
      }),
    );

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data?.subtotalCents).toBe(4000); // (1800 + 200) * 2
    expect(createArgs?.data?.lineItems).toEqual([
      {
        productId: 'prod-a',
        name: 'Shea Butter',
        priceCents: 2000,
        quantity: 2,
        unit: 'UNIT',
        variantId: 'var-1',
        variantLabel: 'Size: Large',
      },
    ]);
  });
});

describe('POST /api/orders — fractional quantity for weight units', () => {
  const PEPPER = {
    id: 'prod-pepper',
    storeId: 'store-1',
    name: 'Ground Pepper',
    priceCents: 500,
    quantity: 20,
    unit: 'LB',
    status: 'ACTIVE',
    variants: [],
  };

  it('400s INVALID_QUANTITY on a fractional quantity for a UNIT product', async () => {
    prismaMock.product.findMany.mockResolvedValue([PRODUCT_A] as never); // unit: 'UNIT'
    const res = await POST(
      makePost({ ...validBody, items: [{ productId: 'prod-a', quantity: 2.5 }] }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_QUANTITY');
  });

  it('accepts and correctly prices a fractional quantity (12.09 lb) for a weight-unit product', async () => {
    prismaMock.product.findMany.mockResolvedValue([PEPPER] as never);
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    prismaMock.order.update.mockResolvedValue(seededOrder() as never);

    await POST(
      makePost({
        ...validBody,
        items: [{ productId: 'prod-pepper', quantity: 12.09 }],
      }),
    );

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    // 500 * 12.09 = 6045 exactly, rounded to the nearest cent either way.
    expect(createArgs?.data?.subtotalCents).toBe(6045);
    expect(createArgs?.data?.lineItems).toEqual([
      {
        productId: 'prod-pepper',
        name: 'Ground Pepper',
        priceCents: 500,
        quantity: 12.09,
        unit: 'LB',
      },
    ]);
  });

  it('rounds a float-arithmetic-prone quantity to the nearest cent (no fractional-cent DB write)', async () => {
    prismaMock.product.findMany.mockResolvedValue([PEPPER] as never);
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    prismaMock.order.update.mockResolvedValue(seededOrder() as never);

    // 333 * 1.005 = 334.665 — a case that would produce a fractional cent
    // without rounding. Use PEPPER's priceCents via a quantity chosen to
    // exercise the rounding path deterministically.
    await POST(
      makePost({
        ...validBody,
        items: [{ productId: 'prod-pepper', quantity: 0.333 }], // rounds to 0.33 lb
      }),
    );

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(Number.isInteger(createArgs?.data?.subtotalCents)).toBe(true);
    expect(createArgs?.data?.lineItems).toEqual([
      expect.objectContaining({ quantity: 0.33 }), // rounded from 0.333
    ]);
  });

  it('checks stock against the fractional quantity requested', async () => {
    prismaMock.product.findMany.mockResolvedValue([{ ...PEPPER, quantity: 5 }] as never);
    const res = await POST(
      makePost({ ...validBody, items: [{ productId: 'prod-pepper', quantity: 12.09 }] }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PRODUCT_UNAVAILABLE');
  });
});

describe('POST /api/orders — happy path', () => {
  it('creates an Order priced from the DB (not the client) and returns 201 + paymentUrl', async () => {
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    prismaMock.order.update.mockResolvedValue(
      seededOrder({
        providerChargeId: 'cs_test_1',
        paymentUrl: 'https://checkout.stripe.com/pay/cs_test_1',
      }) as never,
    );

    const res = await POST(makePost(validBody));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'order_seed_1',
      paymentUrl: 'https://checkout.stripe.com/pay/cs_test_1',
      status: 'PENDING',
    });

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      storeId: 'store-1',
      userId: null,
      amount: 3600, // 2 * 1800, priced from the DB row — client sent no price at all
      subtotalCents: 3600,
      currency: 'USD',
      status: 'PENDING',
      provider: 'stripe_platform',
    });
    expect(mockExecute).toHaveBeenCalledOnce();

    const updateArgs = prismaMock.order.update.mock.calls[0]?.[0];
    expect(updateArgs?.data).toMatchObject({
      providerChargeId: 'cs_test_1',
      paymentUrl: 'https://checkout.stripe.com/pay/cs_test_1',
    });
  });

  it('adds the store-configured delivery fee to the order total (Phase 5)', async () => {
    prismaMock.store.findFirst.mockResolvedValue({ ...STORE, deliveryFeeCents: 500 } as never);
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    prismaMock.order.update.mockResolvedValue(seededOrder() as never);

    await POST(makePost(validBody));

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      subtotalCents: 3600,
      deliveryFeeCents: 500,
      amount: 4100,
    });
  });

  it('sets Order.userId when the caller happens to be logged in', async () => {
    mockOptionalAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    prismaMock.order.create.mockResolvedValue(seededOrder({ userId: 'user-1' }) as never);
    prismaMock.order.update.mockResolvedValue(seededOrder({ userId: 'user-1' }) as never);

    await POST(makePost(validBody));

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data?.userId).toBe('user-1');
  });
});

describe('POST /api/orders — idempotency (CR-02)', () => {
  it('replays the prior outcome on the same Idempotency-Key + same cart', async () => {
    const hash = fingerprintBody({
      storeId: 'store-1',
      items: [{ productId: 'prod-a', quantity: 2 }],
    });
    prismaMock.order.findUnique.mockResolvedValue(
      seededOrder({
        id: 'order_existing',
        idempotencyBodyHash: hash,
        paymentUrl: 'https://checkout.stripe.com/pay/existing',
      }) as never,
    );

    const res = await POST(makePost(validBody, { idempotencyKey: 'replay-key' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'order_existing',
      paymentUrl: 'https://checkout.stripe.com/pay/existing',
    });
    expect(prismaMock.order.create).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('422s IDEMPOTENCY_KEY_BODY_MISMATCH when the same key is reused for a different cart', async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      seededOrder({ id: 'order_existing', idempotencyBodyHash: 'deadbeef'.repeat(8) }) as never,
    );

    const res = await POST(makePost(validBody, { idempotencyKey: 'reused-key' }));

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('IDEMPOTENCY_KEY_BODY_MISMATCH');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('503s PAYMENT_IN_FLIGHT when the prior attempt crashed before a paymentUrl was set', async () => {
    const hash = fingerprintBody({
      storeId: 'store-1',
      items: [{ productId: 'prod-a', quantity: 2 }],
    });
    prismaMock.order.findUnique.mockResolvedValue(
      seededOrder({ id: 'order_inflight', idempotencyBodyHash: hash, paymentUrl: null }) as never,
    );

    const res = await POST(makePost(validBody, { idempotencyKey: 'inflight-key' }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.headers.get('Retry-After')).toBe('5');
  });

  it('503s PAYMENT_PROVIDER_UNAVAILABLE when replaying a terminal FAILED order', async () => {
    const hash = fingerprintBody({
      storeId: 'store-1',
      items: [{ productId: 'prod-a', quantity: 2 }],
    });
    prismaMock.order.findUnique.mockResolvedValue(
      seededOrder({ id: 'order_failed', idempotencyBodyHash: hash, status: 'FAILED' }) as never,
    );

    const res = await POST(makePost(validBody, { idempotencyKey: 'failed-key' }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders — provider failure handling', () => {
  it('503s PAYMENT_PROVIDER_UNCONFIGURED when Stripe env is missing (no Order row created)', async () => {
    mockGetProvider.mockImplementation(() => {
      throw new PaymentProviderUnconfiguredError();
    });

    const res = await POST(makePost(validBody));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNCONFIGURED');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('503s PAYMENT_PROVIDER_UNAVAILABLE + marks the Order FAILED when the circuit is open', async () => {
    prismaMock.order.create.mockResolvedValue(seededOrder({ id: 'order_circuit' }) as never);
    prismaMock.order.update.mockResolvedValue(
      seededOrder({ id: 'order_circuit', status: 'FAILED' }) as never,
    );
    const retryAt = new Date(Date.now() + 60_000);
    mockExecute.mockImplementationOnce(async () => {
      throw new CircuitOpenError('stripe.charge', retryAt);
    });

    const res = await POST(makePost(validBody));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(prismaMock.order.update).toHaveBeenCalledWith({
      where: { id: 'order_circuit' },
      data: { status: 'FAILED' },
    });
  });

  it('502s PAYMENT_FAILED + marks the Order FAILED when Stripe itself throws', async () => {
    prismaMock.order.create.mockResolvedValue(seededOrder({ id: 'order_stripe_err' }) as never);
    prismaMock.order.update.mockResolvedValue(
      seededOrder({ id: 'order_stripe_err', status: 'FAILED' }) as never,
    );
    mockExecute.mockImplementationOnce(async () => {
      throw new Error('Stripe checkout session creation failed: card declined');
    });

    const res = await POST(makePost(validBody));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_FAILED');
  });
});

describe('POST /api/orders — Stripe Connect routing (Phase 3)', () => {
  it('charges via the platform path when the store is not ACTIVE on Connect', async () => {
    prismaMock.order.create.mockResolvedValue(
      seededOrder({ provider: 'stripe_platform' }) as never,
    );
    prismaMock.order.update.mockResolvedValue(seededOrder() as never);

    await POST(makePost(validBody));

    const provider = mockGetProvider.mock.results[0]?.value as {
      charge: ReturnType<typeof vi.fn>;
      chargeConnected: ReturnType<typeof vi.fn>;
    };
    expect(provider.charge).toHaveBeenCalledOnce();
    expect(provider.chargeConnected).not.toHaveBeenCalled();
    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data?.provider).toBe('stripe_platform');
  });

  it('routes as a destination charge once the store is ACTIVE on Connect', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      ...STORE,
      stripeAccountId: 'acct_seller_1',
      stripeOnboardingStatus: 'ACTIVE',
    } as never);
    prismaMock.order.create.mockResolvedValue(seededOrder({ provider: 'stripe_connect' }) as never);
    prismaMock.order.update.mockResolvedValue(
      seededOrder({
        provider: 'stripe_connect',
        providerChargeId: 'cs_connect_1',
        paymentUrl: 'https://checkout.stripe.com/pay/cs_connect_1',
      }) as never,
    );
    process.env.COMMISSION_RATE_BP = '600'; // 6%

    const res = await POST(makePost(validBody));

    expect(res.status).toBe(201);
    const provider = mockGetProvider.mock.results[0]?.value as {
      charge: ReturnType<typeof vi.fn>;
      chargeConnected: ReturnType<typeof vi.fn>;
    };
    expect(provider.chargeConnected).toHaveBeenCalledOnce();
    expect(provider.charge).not.toHaveBeenCalled();
    const chargeArgs = provider.chargeConnected.mock.calls[0]?.[0];
    expect(chargeArgs).toMatchObject({
      destinationAccountId: 'acct_seller_1',
      applicationFeeAmount: 216, // floor(3600 * 600 / 10000)
    });

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data?.provider).toBe('stripe_connect');

    delete process.env.COMMISSION_RATE_BP;
  });

  it('still routes as platform when stripeOnboardingStatus is PENDING/RESTRICTED, not just ACTIVE', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      ...STORE,
      stripeAccountId: 'acct_seller_1',
      stripeOnboardingStatus: 'RESTRICTED',
    } as never);
    prismaMock.order.create.mockResolvedValue(
      seededOrder({ provider: 'stripe_platform' }) as never,
    );
    prismaMock.order.update.mockResolvedValue(seededOrder() as never);

    await POST(makePost(validBody));

    const provider = mockGetProvider.mock.results[0]?.value as {
      charge: ReturnType<typeof vi.fn>;
      chargeConnected: ReturnType<typeof vi.fn>;
    };
    expect(provider.charge).toHaveBeenCalledOnce();
    expect(provider.chargeConnected).not.toHaveBeenCalled();
  });
});

describe('GET /api/orders — seller-facing list (Phase 4)', () => {
  function makeGetReq(qs = ''): NextRequest {
    return new NextRequest(`http://test/api/orders${qs}`, { method: 'GET' });
  }

  it('401s when requireAuth bails', async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Missing token' }, { status: 401 }),
    );
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });

  it('404s NO_STORE when the caller has no store yet', async () => {
    mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    mockResolveOwnStore.mockResolvedValue(null);
    const res = await GET(makeGetReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('NO_STORE');
  });

  it('scopes the list to the caller store and never trusts a client-supplied storeId', async () => {
    mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.order.findMany.mockResolvedValue([]);

    await GET(makeGetReq());

    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ storeId: 'store-1' });
  });

  it('filters by ?status= when provided', async () => {
    mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.order.findMany.mockResolvedValue([]);

    await GET(makeGetReq('?status=PAID'));

    const args = prismaMock.order.findMany.mock.calls[0]?.[0];
    expect(args?.where).toMatchObject({ storeId: 'store-1', status: 'PAID' });
  });

  it('returns items + nextCursor via the shared cursor-pagination shape', async () => {
    mockRequireAuth.mockResolvedValue({ user: { sub: 'user-1', email: 'me@example.com' } });
    mockResolveOwnStore.mockResolvedValue({ id: 'store-1' } as never);
    prismaMock.order.findMany.mockResolvedValue([
      seededOrder({ id: 'o1' }),
      seededOrder({ id: 'o2' }),
    ] as never);

    const res = await GET(makeGetReq());
    const body = await res.json();
    expect(body.items.map((o: { id: string }) => o.id)).toEqual(['o1', 'o2']);
    expect(body.nextCursor).toBeNull();
  });
});

describe('POST /api/orders — manual payment methods (Cash App / Zelle)', () => {
  it('400s PAYMENT_METHOD_UNAVAILABLE for cashapp when the store has no cashAppCashtag', async () => {
    prismaMock.store.findFirst.mockResolvedValue({ ...STORE, cashAppCashtag: null } as never);
    const res = await POST(makePost({ ...validBody, paymentMethod: 'cashapp' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_METHOD_UNAVAILABLE');
    expect(prismaMock.order.create).not.toHaveBeenCalled();
  });

  it('400s PAYMENT_METHOD_UNAVAILABLE for zelle when the store has no zelleContact', async () => {
    prismaMock.store.findFirst.mockResolvedValue({ ...STORE, zelleContact: null } as never);
    const res = await POST(makePost({ ...validBody, paymentMethod: 'zelle' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('creates a cashapp_manual order with no Stripe call and no paymentUrl', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      ...STORE,
      cashAppCashtag: 'AdaezeShop',
    } as never);
    prismaMock.order.create.mockResolvedValue(seededOrder({ provider: 'cashapp_manual' }) as never);

    const res = await POST(makePost({ ...validBody, paymentMethod: 'cashapp' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ id: 'order_seed_1', paymentUrl: null, status: 'PENDING' });

    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({ provider: 'cashapp_manual', status: 'PENDING' });
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('creates a zelle_manual order with no Stripe call and no paymentUrl', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      ...STORE,
      zelleContact: 'adaeze@example.com',
    } as never);
    prismaMock.order.create.mockResolvedValue(seededOrder({ provider: 'zelle_manual' }) as never);

    const res = await POST(makePost({ ...validBody, paymentMethod: 'zelle' }));
    expect(res.status).toBe(201);
    const createArgs = prismaMock.order.create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({ provider: 'zelle_manual' });
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it('defaults to card (existing Stripe behavior) when paymentMethod is omitted', async () => {
    prismaMock.order.create.mockResolvedValue(seededOrder() as never);
    await POST(makePost(validBody)); // validBody has no paymentMethod field at all
    expect(mockGetProvider).toHaveBeenCalled();
  });
});

describe('source invariants', () => {
  it("route source contains runtime='nodejs' and withRequestContext", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    expect(src).toMatch(/export\s+const\s+runtime\s*=\s*['"]nodejs['"]/);
    expect(src).toContain('withRequestContext');
  });
});
