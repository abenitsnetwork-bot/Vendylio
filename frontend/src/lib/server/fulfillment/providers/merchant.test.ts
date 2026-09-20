import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/server/geocoding/google', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/geocoding/google')>(
    '@/lib/server/geocoding/google',
  );
  return { ...actual, geocodeAddress: vi.fn() };
});

import { createMerchantProvider } from './merchant';
import { createPickupProvider } from './pickup';
import type { DeliveryQuoteInput } from '../types';
import type { MethodConfigMerchant } from '../config';
import { geocodeAddress, GeocodingNotConfiguredError } from '@/lib/server/geocoding/google';
import { haversineMiles } from '@/lib/server/geocoding/distance';

const mockGeocode = vi.mocked(geocodeAddress);

const PICKUP = { lat: 40.7128, lng: -74.006 };
const DROPOFF = { lat: 40.758, lng: -73.9855 };

const MILEAGE_CONFIG: MethodConfigMerchant = {
  enabled: true,
  feeCents: 0,
  minOrderCents: 0,
  instructions: null,
  pricingMode: 'MILEAGE',
  mileage: { baseFeeCents: 300, perMileCents: 150, maxMiles: null },
};

const input: DeliveryQuoteInput = {
  pickupAddress: '1 Main St',
  pickupPhone: '+15550000000',
  pickupLat: null,
  pickupLng: null,
  dropoffAddress: { street: '2 Elm St' },
  dropoffPhone: '+15551111111',
  subtotalCents: 3000,
  currency: 'USD',
};

const mileageInput: DeliveryQuoteInput = {
  ...input,
  pickupLat: PICKUP.lat,
  pickupLng: PICKUP.lng,
};

const FLAT_CONFIG: MethodConfigMerchant = {
  enabled: true,
  feeCents: 599,
  minOrderCents: 0,
  instructions: null,
  pricingMode: 'FLAT',
  mileage: { baseFeeCents: 0, perMileCents: 0, maxMiles: null },
};

describe('merchant provider', () => {
  it('quotes the configured flat fee', async () => {
    const p = createMerchantProvider(FLAT_CONFIG);
    await expect(p.quote(input)).resolves.toMatchObject({
      provider: 'MERCHANT',
      serviceable: true,
      feeCents: 599,
    });
  });

  it('is unserviceable below the minimum order', async () => {
    const p = createMerchantProvider({ ...FLAT_CONFIG, minOrderCents: 5000 });
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

describe('merchant provider — MILEAGE pricing', () => {
  beforeEach(() => {
    mockGeocode.mockReset();
  });

  it('charges baseFee + perMile * straight-line distance to the geocoded dropoff', async () => {
    mockGeocode.mockResolvedValueOnce(DROPOFF);
    const p = createMerchantProvider(MILEAGE_CONFIG);
    const q = await p.quote(mileageInput);
    const miles = haversineMiles(PICKUP, DROPOFF);
    expect(q).toMatchObject({
      provider: 'MERCHANT',
      serviceable: true,
      feeCents: Math.round(300 + 150 * miles),
    });
  });

  it('is unserviceable when the store has no geocoded pickup address', async () => {
    const p = createMerchantProvider(MILEAGE_CONFIG);
    const q = await p.quote(input); // pickupLat/Lng both null
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/store address/i);
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it('is unserviceable when the dropoff address is empty', async () => {
    const p = createMerchantProvider(MILEAGE_CONFIG);
    const q = await p.quote({ ...mileageInput, dropoffAddress: null });
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/enter a delivery address/i);
  });

  it('is unserviceable when the dropoff address cannot be geocoded', async () => {
    mockGeocode.mockResolvedValueOnce(null);
    const p = createMerchantProvider(MILEAGE_CONFIG);
    const q = await p.quote(mileageInput);
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/couldn't find that address/i);
  });

  it('is unserviceable when geocoding is not configured', async () => {
    mockGeocode.mockRejectedValueOnce(new GeocodingNotConfiguredError());
    const p = createMerchantProvider(MILEAGE_CONFIG);
    const q = await p.quote(mileageInput);
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/not available/i);
  });

  it('is unserviceable beyond the configured max radius', async () => {
    mockGeocode.mockResolvedValueOnce(DROPOFF);
    const p = createMerchantProvider({
      ...MILEAGE_CONFIG,
      mileage: { ...MILEAGE_CONFIG.mileage, maxMiles: 0.1 },
    });
    const q = await p.quote(mileageInput);
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/delivery radius/i);
  });

  it('still applies the minimum-order gate before pricing distance', async () => {
    const p = createMerchantProvider({ ...MILEAGE_CONFIG, minOrderCents: 5000 });
    const q = await p.quote(mileageInput);
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/minimum order/i);
    expect(mockGeocode).not.toHaveBeenCalled();
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
