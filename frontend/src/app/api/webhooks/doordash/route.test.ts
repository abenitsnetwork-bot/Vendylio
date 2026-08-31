import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';

const webhookLogFindUnique = vi.fn();
const webhookLogCreate = vi.fn();
const webhookLogUpdate = vi.fn();

const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    webhookLog: {
      findUnique: webhookLogFindUnique,
      create: webhookLogCreate,
      update: webhookLogUpdate,
    },
  }),
);
vi.mock('@/lib/server/prisma', () => ({ prisma: { $transaction } }));

const applyCourierWebhookEvent = vi.fn();
vi.mock('@/lib/server/fulfillment/service', () => ({ applyCourierWebhookEvent }));

const SECRET = 'dd-webhook-secret';

function makeReq(body: Record<string, unknown>, sign = true): NextRequest {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sign) {
    headers['x-doordash-signature'] = createHmac('sha256', SECRET).update(payload).digest('hex');
  }
  return new NextRequest('http://localhost/api/webhooks/doordash', {
    method: 'POST',
    headers,
    body: Buffer.from(payload) as unknown as BodyInit,
  });
}

beforeEach(() => {
  vi.stubEnv('DOORDASH_WEBHOOK_SECRET', SECRET);
  webhookLogFindUnique.mockReset().mockResolvedValue(null);
  webhookLogCreate.mockReset();
  webhookLogUpdate.mockReset();
  applyCourierWebhookEvent.mockReset().mockResolvedValue({ matched: true, changed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('POST /api/webhooks/doordash', () => {
  it('401s an unsigned request', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makeReq(
        { event_id: 'e1', external_delivery_id: 'vend_1', delivery_status: 'delivered' },
        false,
      ),
    );
    expect(res.status).toBe(401);
    expect(applyCourierWebhookEvent).not.toHaveBeenCalled();
  });

  it('funnels a delivered event to applyCourierWebhookEvent (correlated on externalDeliveryId)', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({ event_id: 'e1', external_delivery_id: 'vend_del_9', delivery_status: 'delivered' }),
    );
    expect(res.status).toBe(200);
    expect(applyCourierWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerType: 'DOORDASH',
        correlateBy: { externalDeliveryId: 'vend_del_9' },
        rawStatus: 'delivered',
        eventId: 'e1',
      }),
    );
  });

  it('handles a nested delivery.* payload shape', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      makeReq({
        event_id: 'e2',
        delivery: {
          external_delivery_id: 'vend_del_9',
          delivery_status: 'delivery_attempt_failed',
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(applyCourierWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        correlateBy: { externalDeliveryId: 'vend_del_9' },
        rawStatus: 'delivery_attempt_failed',
      }),
    );
  });

  it('is a 200 no-op with no external_delivery_id', async () => {
    const { POST } = await import('./route');
    const res = await POST(makeReq({ event_id: 'e3', delivery_status: 'delivered' }));
    expect(res.status).toBe(200);
    expect(applyCourierWebhookEvent).not.toHaveBeenCalled();
  });

  it('exports runtime=nodejs and dynamic=force-dynamic', async () => {
    const mod = (await import('./route')) as { runtime?: string; dynamic?: string };
    expect(mod.runtime).toBe('nodejs');
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
