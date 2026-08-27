import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/delivery/uber-direct', () => ({
  getUberDirectDeliveryFeeCents: vi.fn(),
}));

import { getUberDirectDeliveryFeeCents } from '@/lib/server/delivery/uber-direct';
import { POST } from './route';

const mockGetUberDirectDeliveryFeeCents = vi.mocked(getUberDirectDeliveryFeeCents);

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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUberDirectDeliveryFeeCents.mockResolvedValue(null);
});

describe('POST /api/stores/[slug]/delivery-quote', () => {
  it('403s when CSRF header is missing', async () => {
    const res = await POST(makePost(VALID_BODY, 'missing'), ctx);
    expect(res.status).toBe(403);
  });

  it('400s VALIDATION_FAILED on a malformed body', async () => {
    const res = await POST(makePost({}), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('VALIDATION_FAILED');
  });

  it('404s STORE_NOT_FOUND for an unknown or unpublished slug', async () => {
    prismaMock.store.findFirst.mockResolvedValue(null);
    const res = await POST(makePost(VALID_BODY), ctx);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('STORE_NOT_FOUND');
  });

  it('returns the flat fee as an estimate for a self_manual store (no Uber call)', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      deliveryProvider: 'self_manual',
      deliveryFeeCents: 500,
      pickupAddress: null,
    } as never);

    const res = await POST(makePost(VALID_BODY), ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ feeCents: 500, isEstimate: true });
    expect(mockGetUberDirectDeliveryFeeCents).not.toHaveBeenCalled();
  });

  it('returns the real quote for an uber_direct store', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      deliveryProvider: 'uber_direct',
      deliveryFeeCents: 500,
      pickupAddress: '1 Pickup Ave, Springfield, IL 62704',
    } as never);
    mockGetUberDirectDeliveryFeeCents.mockResolvedValue(1099);

    const res = await POST(makePost(VALID_BODY), ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ feeCents: 1099, isEstimate: false });
    expect(mockGetUberDirectDeliveryFeeCents).toHaveBeenCalledWith({
      pickupAddress: '1 Pickup Ave, Springfield, IL 62704',
      deliveryAddress: VALID_BODY.deliveryAddress,
      amountCents: 4500,
    });
  });

  it('falls back to the flat fee (marked as an estimate) when the quote comes back null', async () => {
    prismaMock.store.findFirst.mockResolvedValue({
      deliveryProvider: 'uber_direct',
      deliveryFeeCents: 500,
      pickupAddress: '1 Pickup Ave, Springfield, IL 62704',
    } as never);
    mockGetUberDirectDeliveryFeeCents.mockResolvedValue(null);

    const res = await POST(makePost(VALID_BODY), ctx);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ feeCents: 500, isEstimate: true });
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
