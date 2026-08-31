import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { createQuote } = vi.hoisted(() => ({ createQuote: vi.fn() }));
vi.mock('@/lib/server/fulfillment/service', () => ({ createQuote }));

import { POST } from './route';

const ctx = { params: Promise.resolve({ slug: 'shea-store' }) };

function makePost(body: unknown, csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'any-nonempty-value';
  return new NextRequest('http://test/api/stores/shea-store/delivery-quote', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  deliveryAddress: { street: '10 Main St', city: 'Springfield', state: 'IL', zip: '62704' },
  amountCents: 4500,
};

const STORE = {
  id: 'store-1',
  phone: '+15550000000',
  pickupAddress: '1 Pickup Ave',
  deliveryProvider: 'self_manual',
  deliveryFeeCents: 500,
  fulfillmentConfig: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.store.findFirst.mockResolvedValue(STORE as never);
  createQuote.mockResolvedValue({
    batchId: 'b1',
    currency: 'USD',
    customerChoosesProvider: false,
    options: [
      {
        method: 'DELIVERY',
        provider: 'MERCHANT',
        friendlyName: 'Merchant delivery',
        quoteId: 'q1',
        feeCents: 500,
        serviceable: true,
        isEstimate: true,
        estimatedDropoffAt: null,
        expiresAt: null,
      },
      {
        method: 'PICKUP',
        provider: 'PICKUP',
        friendlyName: 'Pickup',
        quoteId: null,
        feeCents: 0,
        serviceable: true,
        isEstimate: false,
        estimatedDropoffAt: null,
        expiresAt: null,
      },
    ],
    deliveryUnavailable: false,
    notServiceable: false,
  });
});

describe('POST /api/stores/[slug]/delivery-quote', () => {
  it('403s when CSRF header is missing', async () => {
    expect((await POST(makePost(VALID_BODY, 'missing'), ctx)).status).toBe(403);
  });

  it('400s VALIDATION_FAILED on a malformed body', async () => {
    const res = await POST(makePost({}), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('VALIDATION_FAILED');
  });

  it('404s STORE_NOT_FOUND for an unknown or unpublished slug', async () => {
    prismaMock.store.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makePost(VALID_BODY), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('STORE_NOT_FOUND');
  });

  it('returns the option array from createQuote', async () => {
    const res = await POST(makePost(VALID_BODY), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.options).toHaveLength(2);
    expect(body.options.map((o: { provider: string }) => o.provider)).toEqual([
      'MERCHANT',
      'PICKUP',
    ]);
    expect(createQuote).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        storeId: 'store-1',
        subtotalCents: 4500,
        dropoffAddress: VALID_BODY.deliveryAddress,
      }),
    );
  });

  it('passes deliveryUnavailable straight through', async () => {
    createQuote.mockResolvedValueOnce({
      batchId: 'b2',
      currency: 'USD',
      customerChoosesProvider: false,
      options: [
        {
          method: 'PICKUP',
          provider: 'PICKUP',
          friendlyName: 'Pickup',
          quoteId: null,
          feeCents: 0,
          serviceable: true,
          isEstimate: false,
          estimatedDropoffAt: null,
          expiresAt: null,
        },
      ],
      deliveryUnavailable: true,
      notServiceable: true,
    });
    const body = await (await POST(makePost(VALID_BODY), ctx)).json();
    expect(body.deliveryUnavailable).toBe(true);
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
