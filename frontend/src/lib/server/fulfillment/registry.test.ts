import { describe, it, expect } from 'vitest';
import { getDeliveryProvider } from './registry';
import { PROVIDER_TYPES } from './types';

describe('getDeliveryProvider', () => {
  it('resolves every declared ProviderType to an adapter of that type', () => {
    for (const t of PROVIDER_TYPES) {
      const p = getDeliveryProvider(t);
      expect(p.type).toBe(t);
      expect(typeof p.friendlyName).toBe('string');
      expect(typeof p.isConfigured).toBe('function');
      expect(typeof p.quote).toBe('function');
      expect(typeof p.createDelivery).toBe('function');
      expect(typeof p.normalizeStatus).toBe('function');
    }
  });

  it('MERCHANT and PICKUP are always configured; couriers depend on env', () => {
    expect(getDeliveryProvider('MERCHANT').isConfigured()).toBe(true);
    expect(getDeliveryProvider('PICKUP').isConfigured()).toBe(true);
  });

  it('passes merchant config through for the quote path', async () => {
    const p = getDeliveryProvider('MERCHANT', {
      merchant: { enabled: true, feeCents: 799, minOrderCents: 0, instructions: null },
    });
    const q = await p.quote({
      pickupAddress: null,
      pickupPhone: null,
      dropoffAddress: null,
      dropoffPhone: null,
      subtotalCents: 5000,
      currency: 'USD',
    });
    expect(q).toMatchObject({ provider: 'MERCHANT', serviceable: true, feeCents: 799 });
  });

  it('exposes friendly names, never the raw enum', () => {
    expect(getDeliveryProvider('UBER_DIRECT').friendlyName).toBe('Uber');
    expect(getDeliveryProvider('DOORDASH').friendlyName).toBe('DoorDash');
    expect(getDeliveryProvider('MERCHANT').friendlyName).toBe('Merchant delivery');
    expect(getDeliveryProvider('PICKUP').friendlyName).toBe('Pickup');
  });
});
