import { describe, it, expect } from 'vitest';
import { createMerchantProvider } from './merchant';
import { createPickupProvider } from './pickup';
import type { DeliveryQuoteInput } from '../types';

const input: DeliveryQuoteInput = {
  pickupAddress: '1 Main St',
  pickupPhone: '+15550000000',
  dropoffAddress: { street: '2 Elm St' },
  dropoffPhone: '+15551111111',
  subtotalCents: 3000,
  currency: 'USD',
};

describe('merchant provider', () => {
  it('quotes the configured flat fee', async () => {
    const p = createMerchantProvider({
      enabled: true,
      feeCents: 599,
      minOrderCents: 0,
      instructions: null,
    });
    await expect(p.quote(input)).resolves.toMatchObject({
      provider: 'MERCHANT',
      serviceable: true,
      feeCents: 599,
    });
  });

  it('is unserviceable below the minimum order', async () => {
    const p = createMerchantProvider({
      enabled: true,
      feeCents: 599,
      minOrderCents: 5000,
      instructions: null,
    });
    const q = await p.quote(input);
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/minimum order/i);
  });

  it('creates a no-op delivery (no external id, REQUESTED)', async () => {
    const p = createMerchantProvider();
    const r = await p.createDelivery({
      externalDeliveryId: 'vend_x',
      orderId: 'o1',
      storeId: 's1',
      storeName: 'S',
      pickupAddress: null,
      pickupPhone: null,
      customerName: null,
      customerPhone: null,
      dropoffAddress: null,
      subtotalCents: 0,
      currency: 'USD',
      manifestItems: [],
    });
    expect(r).toEqual({ providerDeliveryId: null, state: 'REQUESTED' });
  });

  it('normalizeStatus + testConnection are inert', async () => {
    const p = createMerchantProvider();
    expect(p.normalizeStatus('anything')).toBe('REQUESTED');
    await expect(p.testConnection()).resolves.toMatchObject({ ok: true });
  });
});

describe('pickup provider', () => {
  it('is always free and serviceable', async () => {
    const p = createPickupProvider();
    await expect(p.quote(input)).resolves.toMatchObject({
      provider: 'PICKUP',
      serviceable: true,
      feeCents: 0,
    });
  });

  it('has no external capability', () => {
    expect(createPickupProvider().capabilities.external).toBe(false);
  });
});
