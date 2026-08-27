import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'crypto';
import { uberDirectWebhookProvider } from './uber-direct';

const SIGNING_KEY = 'test-uber-direct-signing-key';

function sign(payload: string, key: string = SIGNING_KEY): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

beforeEach(() => {
  vi.stubEnv('UBER_DIRECT_WEBHOOK_SIGNING_KEY', SIGNING_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('uberDirectWebhookProvider', () => {
  it('rejects when UBER_DIRECT_WEBHOOK_SIGNING_KEY is unset', () => {
    vi.stubEnv('UBER_DIRECT_WEBHOOK_SIGNING_KEY', '');
    const payload = JSON.stringify({ id: 'evt_1', status: 'delivered' });
    const result = uberDirectWebhookProvider.verifySignature(Buffer.from(payload), {
      'x-uber-signature': sign(payload),
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a missing signature header', () => {
    const payload = JSON.stringify({ id: 'evt_1', status: 'delivered' });
    const result = uberDirectWebhookProvider.verifySignature(Buffer.from(payload), {});
    expect(result.valid).toBe(false);
  });

  it('accepts a correctly signed body', () => {
    const payload = JSON.stringify({ id: 'evt_1', status: 'delivered' });
    const result = uberDirectWebhookProvider.verifySignature(Buffer.from(payload), {
      'x-uber-signature': sign(payload),
    });
    expect(result.valid).toBe(true);
  });

  it('accepts the legacy x-postmates-signature alias', () => {
    const payload = JSON.stringify({ id: 'evt_1', status: 'delivered' });
    const result = uberDirectWebhookProvider.verifySignature(Buffer.from(payload), {
      'x-postmates-signature': sign(payload),
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a signature made with the wrong key', () => {
    const payload = JSON.stringify({ id: 'evt_1', status: 'delivered' });
    const result = uberDirectWebhookProvider.verifySignature(Buffer.from(payload), {
      'x-uber-signature': sign(payload, 'wrong-key'),
    });
    expect(result.valid).toBe(false);
  });

  it('rejects a tampered body even with a validly-formatted signature', () => {
    const payload = JSON.stringify({ id: 'evt_1', status: 'delivered' });
    const tamperedSig = sign(JSON.stringify({ id: 'evt_1', status: 'canceled' }));
    const result = uberDirectWebhookProvider.verifySignature(Buffer.from(payload), {
      'x-uber-signature': tamperedSig,
    });
    expect(result.valid).toBe(false);
  });

  it('parsePayload parses JSON', () => {
    const payload = uberDirectWebhookProvider.parsePayload(
      Buffer.from(JSON.stringify({ id: 'evt_1', delivery_id: 'del_1', status: 'delivered' })),
    );
    expect(payload).toEqual({ id: 'evt_1', delivery_id: 'del_1', status: 'delivered' });
  });

  it('extractIds routes "delivered" through the paid bucket', () => {
    const ids = uberDirectWebhookProvider.extractIds({
      id: 'evt_1',
      kind: 'event.delivery_status',
      delivery_id: 'del_1',
      status: 'delivered',
    });
    expect(ids).toEqual({ externalId: 'evt_1', eventType: 'delivered', kind: 'paid' });
  });

  it.each(['canceled', 'returned'])(
    'extractIds routes "%s" through the failed bucket',
    (status) => {
      const ids = uberDirectWebhookProvider.extractIds({
        id: 'evt_1',
        kind: 'event.delivery_status',
        delivery_id: 'del_1',
        status,
      });
      expect(ids.kind).toBe('failed');
    },
  );

  it.each(['pending', 'pickup', 'pickup_complete', 'dropoff'])(
    'extractIds classifies "%s" as other (no-op)',
    (status) => {
      const ids = uberDirectWebhookProvider.extractIds({
        id: 'evt_1',
        kind: 'event.delivery_status',
        delivery_id: 'del_1',
        status,
      });
      expect(ids.kind).toBe('other');
    },
  );
});
