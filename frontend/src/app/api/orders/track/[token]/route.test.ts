import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const TOKEN = 'tok_abcdefabcdefabcdef1234567890';
const ctx = { params: Promise.resolve({ token: TOKEN }) };

function makeReq(): NextRequest {
  return new NextRequest(`http://test/api/orders/track/${TOKEN}`, { method: 'GET' });
}

function orderRow(over: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderNumber: 42,
    status: 'PREPARING',
    currency: 'USD',
    subtotalCents: 3600,
    deliveryFeeCents: 0,
    taxCents: 0,
    amount: 3600,
    lineItems: [{ name: 'Shea Butter', quantity: 2, priceCents: 1800, unit: 'UNIT' }],
    createdAt: new Date('2026-08-01T10:00:00Z'),
    paidAt: new Date('2026-08-01T10:00:30Z'),
    fulfillmentMethod: 'DELIVERY',
    deliveryAddress: null,
    provider: 'stripe_platform',
    store: {
      name: "Consty's Kitchen",
      slug: 'constys-kitchen',
      phone: '555-0100',
      pickupAddress: null,
      cashAppCashtag: null,
      zelleContact: null,
    },
    statusEvents: [
      { status: 'PAID', createdAt: new Date('2026-08-01T10:00:30Z') },
      { status: 'PREPARING', createdAt: new Date('2026-08-01T10:10:00Z') },
    ],
    delivery: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/orders/track/[token]', () => {
  it('is public and returns a customer view model keyed on the token', async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderRow() as never);
    prismaMock.review.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');

    const body = await res.json();
    expect(body.order.reference).toBe('VND-10042');
    expect(body.order.status).toEqual({
      key: 'PREPARING',
      label: 'Being prepared',
      description: 'The store is preparing your order.',
    });
    expect(
      body.order.timeline.map((s: { key: string; state: string }) => `${s.key}:${s.state}`),
    ).toEqual([
      'CONFIRMED:done',
      'PREPARING:done',
      'READY:current',
      'ON_THE_WAY:upcoming',
      'DELIVERED:upcoming',
    ]);
    expect(prismaMock.order.findUnique.mock.calls[0]?.[0]?.where).toEqual({ trackingToken: TOKEN });
  });

  it('never selects or returns seller-financial fields (§31/§191/§193)', async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderRow() as never);
    prismaMock.review.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq(), ctx);
    const body = await res.json();

    const select = prismaMock.order.findUnique.mock.calls[0]?.[0]?.select;
    expect(select).not.toHaveProperty('commissionAmount');
    expect(select).not.toHaveProperty('netAmount');
    expect(select).not.toHaveProperty('customerEmail');
    expect(select).not.toHaveProperty('customerPhone');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('commissionAmount');
    expect(serialized).not.toContain('netAmount');
    // the internal cuid id is never sent to the customer
    expect(serialized).not.toContain('order-1');
  });

  it('404s without revealing whether another order exists (§142/§160)', async () => {
    prismaMock.order.findUnique.mockResolvedValue(null);
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('ORDER_NOT_FOUND');
    expect(body.message).toBe("We couldn't find this order.");
  });

  it('short-circuits an implausible token before hitting the DB', async () => {
    const res = await GET(new NextRequest('http://test/api/orders/track/x', { method: 'GET' }), {
      params: Promise.resolve({ token: 'x' }),
    });
    expect(res.status).toBe(404);
    expect(prismaMock.order.findUnique).not.toHaveBeenCalled();
  });

  it('surfaces manual-payment contact info for a PENDING cashapp_manual order', async () => {
    prismaMock.order.findUnique.mockResolvedValue(
      orderRow({
        status: 'PENDING',
        provider: 'cashapp_manual',
        statusEvents: [],
        store: {
          name: 'Adaeze Shop',
          slug: 'adaeze',
          phone: null,
          pickupAddress: null,
          cashAppCashtag: 'AdaezeShop',
          zelleContact: null,
        },
      }) as never,
    );
    prismaMock.review.findUnique.mockResolvedValue(null);

    const res = await GET(makeReq(), ctx);
    const body = await res.json();
    expect(body.order.isManualPaymentPending).toBe(true);
    expect(body.order.store.cashAppCashtag).toBe('AdaezeShop');
  });

  it('reports hasReview from the Review row', async () => {
    prismaMock.order.findUnique.mockResolvedValue(orderRow({ status: 'DELIVERED' }) as never);
    prismaMock.review.findUnique.mockResolvedValue({ id: 'rev-1' } as never);
    const res = await GET(makeReq(), ctx);
    const body = await res.json();
    expect(body.hasReview).toBe(true);
  });
});
