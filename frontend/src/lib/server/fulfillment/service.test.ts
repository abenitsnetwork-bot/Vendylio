import { prismaMock } from '@/test-utils/prisma-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockProvider = {
  type: 'UBER_DIRECT' as const,
  friendlyName: 'Uber',
  capabilities: {
    external: true,
    quotes: true,
    cancellation: true,
    webhooks: true,
    tracking: true,
  },
  isConfigured: vi.fn(() => true),
  quote: vi.fn(),
  createDelivery: vi.fn(),
  getDelivery: vi.fn(),
  cancelDelivery: vi.fn(),
  normalizeStatus: vi.fn(),
  testConnection: vi.fn(),
};
vi.mock('./registry', async (orig) => {
  const actual = await orig<typeof import('./registry')>();
  return {
    ...actual,
    getDeliveryProvider: vi.fn((type: string, ctx?: unknown) =>
      type === 'UBER_DIRECT' || type === 'DOORDASH'
        ? mockProvider
        : actual.getDeliveryProvider(type as never, ctx as never),
    ),
  };
});
vi.mock('@/lib/server/notifications', () => ({ createNotification: vi.fn() }));

import {
  cancelFulfillment,
  createFulfillment,
  handleProviderEvent,
  initFulfillment,
  legacyProviderFor,
  quoteMethod,
  recordTransition,
  selectProvider,
  updateFulfillment,
} from './service';
import { createNotification } from '@/lib/server/notifications';
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
  mockProvider.isConfigured.mockReturnValue(true);
  prismaMock.$transaction.mockImplementation((cb: unknown) => {
    if (typeof cb === 'function') {
      return (cb as (tx: typeof prismaMock) => unknown)(prismaMock) as Promise<unknown>;
    }
    return Promise.resolve(cb);
  });
  prismaMock.$executeRawUnsafe.mockResolvedValue(0 as never);
});

function ctxDelivery(over: Record<string, unknown> = {}) {
  return {
    id: 'del_1',
    orderId: 'ord_1',
    state: 'PENDING',
    providerType: 'UBER_DIRECT',
    externalDeliveryId: null,
    providerDeliveryId: null,
    dispatchedAt: null,
    attemptCount: 0,
    order: {
      id: 'ord_1',
      orderNumber: 10042,
      status: 'READY',
      amount: 5000,
      currency: 'USD',
      customerName: 'Jo',
      customerPhone: '+15550000000',
      deliveryAddress: { street: '1 Main St' },
      lineItems: [{ name: 'Widget', quantity: 1 }],
      storeId: 'store_1',
      store: {
        name: 'Shop',
        phone: '+15551111111',
        pickupAddress: '2 Elm St',
        deliveryProvider: 'uber_direct',
        deliveryFeeCents: 500,
        fulfillmentConfig: {},
        organization: { ownerId: 'owner_1' },
      },
    },
    ...over,
  };
}

function seedTransitionMocks(state = 'PENDING') {
  prismaMock.delivery.findUnique.mockImplementation((args: unknown) => {
    const a = args as { select?: Record<string, unknown> };
    // recordTransition uses a narrow select; createFulfillment uses the wide one
    if (a.select && 'order' in a.select) return ctxDelivery({ state }) as never;
    return { id: 'del_1', orderId: 'ord_1', state, providerType: 'UBER_DIRECT' } as never;
  });
  prismaMock.deliveryEvent.findUnique.mockResolvedValue(null as never);
  prismaMock.deliveryEvent.create.mockResolvedValue({} as never);
  prismaMock.delivery.update.mockResolvedValue({} as never);
  prismaMock.order.findUnique.mockResolvedValue({ status: 'READY' } as never);
  prismaMock.order.update.mockResolvedValue({} as never);
  prismaMock.orderStatusEvent.create.mockResolvedValue({} as never);
}

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
    mockProvider.isConfigured.mockReturnValueOnce(false);
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

describe('createFulfillment', () => {
  it('courier: fresh dispatch → REQUESTED + external id + merchant notification', async () => {
    seedTransitionMocks('PENDING');
    mockProvider.createDelivery.mockResolvedValue({
      providerDeliveryId: 'uber_123',
      state: 'REQUESTED',
      trackingUrl: 'https://track/uber_123',
    });
    const res = await createFulfillment(prismaMock as never, 'del_1', { actor: 'SYSTEM' });
    expect(res).toMatchObject({ state: 'REQUESTED', dispatched: true });
    expect(mockProvider.createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ externalDeliveryId: 'vend_del_1' }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'FULFILLMENT_DISPATCHED' }),
    );
  });

  it('courier: on error below the cap it stays PENDING (cron retries)', async () => {
    seedTransitionMocks('PENDING');
    mockProvider.createDelivery.mockRejectedValue(new Error('provider 503'));
    const res = await createFulfillment(prismaMock as never, 'del_1', { actor: 'SYSTEM' });
    expect(res).toMatchObject({ state: 'PENDING', error: 'provider 503' });
    // no FAILED transition event yet
    const failEvent = prismaMock.deliveryEvent.create.mock.calls.find(
      (c) => (c[0] as { data: { state: string } }).data.state === 'FAILED',
    );
    expect(failEvent).toBeUndefined();
  });

  it('courier: at the attempt cap it moves to FAILED + notifies the merchant', async () => {
    seedTransitionMocks('PENDING');
    prismaMock.delivery.findUnique.mockImplementation((args: unknown) => {
      const a = args as { select?: Record<string, unknown> };
      if (a.select && 'order' in a.select) {
        return ctxDelivery({ state: 'PENDING', attemptCount: 5 }) as never;
      }
      return {
        id: 'del_1',
        orderId: 'ord_1',
        state: 'PENDING',
        providerType: 'UBER_DIRECT',
      } as never;
    });
    mockProvider.createDelivery.mockRejectedValue(new Error('permanently broken'));
    const res = await createFulfillment(prismaMock as never, 'del_1', { actor: 'SYSTEM' });
    expect(res.state).toBe('FAILED');
    expect(createNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'FULFILLMENT_FAILED' }),
    );
  });

  it('courier: already dispatched → reconciles via getDelivery, never re-creates', async () => {
    seedTransitionMocks('REQUESTED');
    prismaMock.delivery.findUnique.mockImplementation((args: unknown) => {
      const a = args as { select?: Record<string, unknown> };
      if (a.select && 'order' in a.select) {
        return ctxDelivery({
          state: 'REQUESTED',
          externalDeliveryId: 'vend_del_1',
          dispatchedAt: new Date(),
        }) as never;
      }
      return {
        id: 'del_1',
        orderId: 'ord_1',
        state: 'REQUESTED',
        providerType: 'UBER_DIRECT',
      } as never;
    });
    mockProvider.getDelivery.mockResolvedValue({
      providerDeliveryId: 'uber_123',
      rawStatus: 'pickup_complete',
      state: 'PICKED_UP',
    });
    const res = await createFulfillment(prismaMock as never, 'del_1', {
      actor: 'MERCHANT',
      force: true,
    });
    expect(mockProvider.createDelivery).not.toHaveBeenCalled();
    expect(mockProvider.getDelivery).toHaveBeenCalledWith('vend_del_1');
    expect(res.state).toBe('PICKED_UP');
  });

  it('merchant provider: advances to OUT_FOR_DELIVERY with no external call', async () => {
    seedTransitionMocks('PENDING');
    prismaMock.delivery.findUnique.mockImplementation((args: unknown) => {
      const a = args as { select?: Record<string, unknown> };
      if (a.select && 'order' in a.select) {
        return ctxDelivery({
          state: 'PENDING',
          providerType: 'MERCHANT',
          order: {
            ...ctxDelivery().order,
            store: { ...ctxDelivery().order.store, deliveryProvider: 'self_manual' },
          },
        }) as never;
      }
      return { id: 'del_1', orderId: 'ord_1', state: 'PENDING', providerType: 'MERCHANT' } as never;
    });
    const res = await createFulfillment(prismaMock as never, 'del_1', { actor: 'MERCHANT' });
    expect(res).toEqual({ state: 'OUT_FOR_DELIVERY', dispatched: false });
    expect(mockProvider.createDelivery).not.toHaveBeenCalled();
  });
});

describe('updateFulfillment / cancelFulfillment', () => {
  it('updateFulfillment marks a merchant delivery DELIVERED', async () => {
    seedTransitionMocks('OUT_FOR_DELIVERY');
    prismaMock.order.findUnique.mockResolvedValue({ status: 'OUT_FOR_DELIVERY' } as never);
    const res = await updateFulfillment(prismaMock as never, 'del_1', 'DELIVERED', 'MERCHANT');
    expect(res.changed).toBe(true);
    expect(res.state).toBe('DELIVERED');
  });

  it('cancelFulfillment refuses when the courier will not cancel', async () => {
    seedTransitionMocks('OUT_FOR_DELIVERY');
    prismaMock.delivery.findUnique.mockImplementation((args: unknown) => {
      const a = args as { select?: Record<string, unknown> };
      if (a.select && 'order' in a.select) {
        return ctxDelivery({
          state: 'OUT_FOR_DELIVERY',
          externalDeliveryId: 'vend_del_1',
        }) as never;
      }
      return {
        id: 'del_1',
        orderId: 'ord_1',
        state: 'OUT_FOR_DELIVERY',
        providerType: 'UBER_DIRECT',
      } as never;
    });
    mockProvider.cancelDelivery.mockResolvedValue({ cancelled: false, reason: 'courier assigned' });
    const res = await cancelFulfillment(prismaMock as never, 'del_1');
    expect(res).toMatchObject({ cancelled: false, reason: 'courier assigned' });
  });

  it('cancelFulfillment cancels a merchant delivery', async () => {
    seedTransitionMocks('OUT_FOR_DELIVERY');
    prismaMock.delivery.findUnique.mockImplementation((args: unknown) => {
      const a = args as { select?: Record<string, unknown> };
      if (a.select && 'order' in a.select) {
        return ctxDelivery({ state: 'OUT_FOR_DELIVERY', providerType: 'MERCHANT' }) as never;
      }
      return {
        id: 'del_1',
        orderId: 'ord_1',
        state: 'OUT_FOR_DELIVERY',
        providerType: 'MERCHANT',
      } as never;
    });
    prismaMock.order.findUnique.mockResolvedValue({ status: 'OUT_FOR_DELIVERY' } as never);
    const res = await cancelFulfillment(prismaMock as never, 'del_1', { reason: 'buyer no-show' });
    expect(res.cancelled).toBe(true);
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
