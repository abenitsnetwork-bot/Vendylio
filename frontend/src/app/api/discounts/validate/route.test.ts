import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

function makeReq(qs: string) {
  return new NextRequest(`http://test/api/discounts/validate?${qs}`, { method: 'GET' });
}

const ACTIVE = {
  kind: 'FREE_DELIVERY',
  active: true,
  startsAt: null,
  endsAt: null,
  minSubtotalCents: 0,
  maxRedemptions: null,
  redemptionCount: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findFirst.mockResolvedValue({ id: 'store-1', deliveryFeeCents: 599 } as never);
});

describe('GET /api/discounts/validate', () => {
  it('400s without slug or code', async () => {
    expect((await GET(makeReq('slug=shea'))).status).toBe(400);
    expect((await GET(makeReq('code=X'))).status).toBe(400);
  });

  it('404s on an unknown store', async () => {
    prismaMock.store.findFirst.mockResolvedValueOnce(null);
    expect((await GET(makeReq('slug=nope&code=X&subtotal=1000'))).status).toBe(404);
  });

  it('returns valid:true for an active FREE_DELIVERY code', async () => {
    prismaMock.discount.findUnique.mockResolvedValue(ACTIVE as never);
    const res = await GET(makeReq('slug=shea&code=freeship&subtotal=5000'));
    const body = await res.json();
    expect(body).toMatchObject({ valid: true, code: 'FREESHIP', kind: 'FREE_DELIVERY' });
  });

  it('returns valid:false + reason for an unknown code', async () => {
    prismaMock.discount.findUnique.mockResolvedValue(null as never);
    const body = await (await GET(makeReq('slug=shea&code=NOPE&subtotal=5000'))).json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe('NOT_FOUND');
  });

  it('returns valid:false + MIN_SUBTOTAL when the cart is too small', async () => {
    prismaMock.discount.findUnique.mockResolvedValue({
      ...ACTIVE,
      minSubtotalCents: 10000,
    } as never);
    const body = await (await GET(makeReq('slug=shea&code=FREESHIP&subtotal=5000'))).json();
    expect(body).toMatchObject({ valid: false, reason: 'MIN_SUBTOTAL' });
  });
});
