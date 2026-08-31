import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/server/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/server/orders/ownership', () => ({ findOwnedOrder: vi.fn() }));
vi.mock('@/lib/server/fulfillment/service', () => ({ cancelFulfillment: vi.fn() }));

import { requireAuth } from '@/lib/server/middleware';
import { findOwnedOrder } from '@/lib/server/orders/ownership';
import { cancelFulfillment } from '@/lib/server/fulfillment/service';
import { POST } from './route';

const ctx = { params: Promise.resolve({ id: 'order-1' }) };

function req(csrf: 'match' | 'missing' = 'match'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf === 'match') headers['x-csrf-token'] = 'tok';
  return new NextRequest('http://test/api/orders/order-1/delivery/cancel', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ user: { sub: 'u1', email: 'a@b.c' } } as never);
  vi.mocked(findOwnedOrder).mockResolvedValue({
    store: { id: 's1' },
    order: { id: 'order-1' },
  } as never);
  prismaMock.delivery.findUnique.mockResolvedValue({ id: 'del-1' } as never);
  vi.mocked(cancelFulfillment).mockResolvedValue({ cancelled: true, state: 'CANCELLED' });
});

describe('POST /api/orders/[id]/delivery/cancel', () => {
  it('403s without CSRF', async () => {
    expect((await POST(req('missing'), ctx)).status).toBe(403);
  });

  it("404s when the order isn't the caller's (IDOR)", async () => {
    vi.mocked(findOwnedOrder).mockResolvedValueOnce({ store: null, order: null } as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('ORDER_NOT_FOUND');
    expect(cancelFulfillment).not.toHaveBeenCalled();
  });

  it('404s DELIVERY_NOT_FOUND when there is no delivery', async () => {
    prismaMock.delivery.findUnique.mockResolvedValueOnce(null);
    expect((await POST(req(), ctx)).status).toBe(404);
  });

  it('409s DELIVERY_CANCEL_NOT_ALLOWED when the courier refuses', async () => {
    vi.mocked(cancelFulfillment).mockResolvedValueOnce({
      cancelled: false,
      reason: 'Dasher assigned',
    });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('DELIVERY_CANCEL_NOT_ALLOWED');
  });

  it('cancels via the service on success', async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(cancelFulfillment).toHaveBeenCalledWith(
      expect.anything(),
      'del-1',
      expect.objectContaining({ actor: 'MERCHANT' }),
    );
  });
});
