import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleProviderEvent,
  initFulfillment,
  legacyProviderFor,
  quoteMethod,
  recordTransition,
  selectProvider,
} from './service';
import type { DeliveryQuote, ProviderSnapshot } from './types';
import { readFulfillmentConfig } from './config';

type DeliveryRow = {
  id: string;
  orderId: string;
  state: string;
  providerType: string | null;
};

function seedDelivery(row: Partial<DeliveryRow> = {}) {
  const delivery: DeliveryRow = {
    id: 'del_1',
    orderId: 'ord_1',
    state: 'REQUESTED',
    providerType: 'UBER_DIRECT',
    ...row,
  };
  prismaMock.delivery.findUnique.mockResolvedValue(delivery as never);
  prismaMock.deliveryEvent.findUnique.mockResolvedValue(null as never);
  prismaMock.deliveryEvent.create.mockResolvedValue({} as never);
  prismaMock.delivery.update.mockResolvedValue({} as never);
  prismaMock.order.findUnique.mockResolvedValue({ status: 'PREPARING' } as never);
  prismaMock.order.update.mockResolvedValue({} as never);
  prismaMock.orderStatusEvent.create.mockResolvedValue({} as never);
  return delivery;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordTransition', () => {
  it('applies a legal forward transition + dual-writes the legacy status', async () => {
    seedDelivery({ state: 'REQUESTED' });
    const res = await recordTransition(prismaMock as never, {
      deliveryId: 'del_1',
      toState: 'PICKED_UP',
      actor: 'PROVIDER',
      providerEventId: 'evt_1',
    });
    expect(res).toEqual({ changed: true, deduped: false, state: 'PICKED_UP' });
    const patch = prismaMock.delivery.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(patch.state).toBe('PICKED_UP');
    expect(patch.status).toBe('REQUESTED'); // legacy stays REQUESTED until DELIVERED/FAILED
    expect(prismaMock.deliveryEvent.create).toHaveBeenCalledTimes(1);
  });

  it('moves the Order to OUT_FOR_DELIVERY on PICKED_UP', async () => {
    seedDelivery({ state: 'CONFIRMED' });
    await recordTransition(prismaMock as never, {
      deliveryId: 'del_1',
      toState: 'PICKED_UP',
      actor: 'PROVIDER',
    });
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'OUT_FOR_DELIVERY' } }),
    );
    expect(prismaMock.orderStatusEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OUT_FOR_DELIVERY', actorType: 'SYSTEM' }),
      }),
    );
  });

  it('is idempotent — a repeat providerEventId is a no-op', async () => {
    seedDelivery({ state: 'REQUESTED' });
    prismaMock.deliveryEvent.findUnique.mockResolvedValue({ id: 'e' } as never);
    const res = await recordTransition(prismaMock as never, {
      deliveryId: 'del_1',
      toState: 'DELIVERED',
      actor: 'PROVIDER',
      providerEventId: 'evt_dup',
    });
    expect(res).toEqual({ changed: false, deduped: true, state: 'REQUESTED' });
    expect(prismaMock.delivery.update).not.toHaveBeenCalled();
    expect(prismaMock.deliveryEvent.create).not.toHaveBeenCalled();
  });

  it('records but does not apply an out-of-order event', async () => {
    seedDelivery({ state: 'OUT_FOR_DELIVERY' });
    const res = await recordTransition(prismaMock as never, {
      deliveryId: 'del_1',
      toState: 'CONFIRMED',
      actor: 'PROVIDER',
      providerEventId: 'evt_late',
    });
    expect(res.changed).toBe(false);
    expect(prismaMock.deliveryEvent.create).toHaveBeenCalledTimes(1); // forensics
    expect(prismaMock.delivery.update).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });

  it('reverts the Order to READY on FAILED only when it is OUT_FOR_DELIVERY', async () => {
    seedDelivery({ state: 'OUT_FOR_DELIVERY' });
    prismaMock.order.findUnique.mockResolvedValue({ status: 'OUT_FOR_DELIVERY' } as never);
    await recordTransition(prismaMock as never, {
      deliveryId: 'del_1',
      toState: 'FAILED',
      actor: 'PROVIDER',
    });
    expect(prismaMock.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'READY' } }),
    );
  });

  it('does NOT touch a READY order on FAILED', async () => {
    seedDelivery({ state: 'REQUESTED' });
    prismaMock.order.findUnique.mockResolvedValue({ status: 'READY' } as never);
    await recordTransition(prismaMock as never, {
      deliveryId: 'del_1',
      toState: 'FAILED',
      actor: 'PROVIDER',
    });
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });
});

describe('initFulfillment', () => {
  it('upserts a PENDING Delivery with the legacy provider name', async () => {
    prismaMock.delivery.upsert.mockResolvedValue({} as never);
    await initFulfillment(prismaMock as never, {
      orderId: 'ord_9',
      providerType: 'DOORDASH',
      feeCents: 850,
      currency: 'USD',
    });
    const arg = prismaMock.delivery.upsert.mock.calls[0]?.[0];
    expect(arg?.where).toEqual({ orderId: 'ord_9' });
    expect(arg?.create).toMatchObject({
      state: 'PENDING',
      providerType: 'DOORDASH',
      provider: 'doordash',
      feeCents: 850,
    });
    expect(arg?.update).toEqual({});
  });
});

describe('handleProviderEvent', () => {
  it('folds a snapshot through recordTransition', async () => {
    seedDelivery({ state: 'REQUESTED' });
    const snapshot: ProviderSnapshot = {
      providerDeliveryId: 'ext_1',
      rawStatus: 'dropoff',
      state: 'OUT_FOR_DELIVERY',
      trackingUrl: 'https://track/abc',
    };
    const res = await handleProviderEvent(prismaMock as never, {
      deliveryId: 'del_1',
      snapshot,
      source: 'CRON',
      providerEventId: 'poll:hash1',
    });
    expect(res.changed).toBe(true);
    const patch = prismaMock.delivery.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(patch.trackingUrl).toBe('https://track/abc');
    expect(patch.providerDeliveryId).toBe('ext_1');
  });

  it('records an UNKNOWN snapshot without moving state', async () => {
    seedDelivery({ state: 'REQUESTED' });
    const snapshot: ProviderSnapshot = {
      providerDeliveryId: null,
      rawStatus: 'weird_new_thing',
      state: 'UNKNOWN',
    };
    const res = await handleProviderEvent(prismaMock as never, {
      deliveryId: 'del_1',
      snapshot,
      source: 'PROVIDER',
      providerEventId: 'evt_unknown',
    });
    expect(res.changed).toBe(false);
    expect(prismaMock.deliveryEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'UNKNOWN' }) }),
    );
    expect(prismaMock.delivery.update).not.toHaveBeenCalled();
  });
});

describe('selectProvider', () => {
  const config = readFulfillmentConfig({
    fulfillmentConfig: {},
    deliveryProvider: 'self_manual',
    deliveryFeeCents: 500,
  });
  const q = (
    provider: DeliveryQuote['provider'],
    feeCents: number,
    serviceable = true,
  ): DeliveryQuote => ({
    provider,
    serviceable,
    feeCents,
    currency: 'USD',
  });

  it('always picks PICKUP for a pickup order', () => {
    expect(selectProvider({ method: 'PICKUP', config, quotes: [] })).toEqual({
      ok: true,
      providerType: 'PICKUP',
    });
  });

  it('picks the cheapest serviceable delivery quote by default', () => {
    const choice = selectProvider({
      method: 'DELIVERY',
      config,
      quotes: [q('UBER_DIRECT', 900), q('DOORDASH', 820), q('MERCHANT', 850)],
    });
    expect(choice.providerType).toBe('DOORDASH');
  });

  it('honours the customer pick when the store allows it', () => {
    const choice = selectProvider({
      method: 'DELIVERY',
      config: { ...config, customerChoosesProvider: true },
      quotes: [q('UBER_DIRECT', 900), q('DOORDASH', 820)],
      chosenProviderType: 'UBER_DIRECT',
    });
    expect(choice).toMatchObject({ ok: true, providerType: 'UBER_DIRECT' });
  });

  it('fails when nothing can service the address', () => {
    const choice = selectProvider({
      method: 'DELIVERY',
      config,
      quotes: [q('UBER_DIRECT', 0, false), q('DOORDASH', 0, false)],
    });
    expect(choice.ok).toBe(false);
  });

  it('fails when the customer pick is no longer serviceable', () => {
    const choice = selectProvider({
      method: 'DELIVERY',
      config: { ...config, customerChoosesProvider: true },
      quotes: [q('DOORDASH', 820)],
      chosenProviderType: 'UBER_DIRECT',
    });
    expect(choice.ok).toBe(false);
  });
});

describe('quoteMethod', () => {
  it('returns unserviceable when the provider is not configured', async () => {
    const res = await quoteMethod(
      'DOORDASH',
      {
        pickupAddress: null,
        pickupPhone: null,
        dropoffAddress: null,
        dropoffPhone: null,
        subtotalCents: 0,
        currency: 'USD',
      },
      {},
      100,
    );
    expect(res.serviceable).toBe(false);
  });

  it('resolves the merchant flat fee within the timeout', async () => {
    const res = await quoteMethod(
      'MERCHANT',
      {
        pickupAddress: null,
        pickupPhone: null,
        dropoffAddress: null,
        dropoffPhone: null,
        subtotalCents: 4000,
        currency: 'USD',
      },
      { merchant: { enabled: true, feeCents: 350, minOrderCents: 0, instructions: null } },
      1000,
    );
    expect(res).toMatchObject({ serviceable: true, feeCents: 350 });
  });
});

describe('legacyProviderFor', () => {
  it('maps to the Phase-5 strings', () => {
    expect(legacyProviderFor('UBER_DIRECT')).toBe('uber_direct');
    expect(legacyProviderFor('DOORDASH')).toBe('doordash');
    expect(legacyProviderFor('MERCHANT')).toBe('self_manual');
    expect(legacyProviderFor('PICKUP')).toBe('self_manual');
  });
});
