import { describe, it, expect } from 'vitest';
import {
  enabledProviderTypes,
  readFulfillmentConfig,
  resolveOrderProviderType,
  serializeFulfillmentConfig,
} from './config';

describe('readFulfillmentConfig', () => {
  it('backfills a legacy self_manual store (empty config)', () => {
    const cfg = readFulfillmentConfig({
      fulfillmentConfig: {},
      deliveryProvider: 'self_manual',
      deliveryFeeCents: 500,
    });
    expect(cfg.pickup.enabled).toBe(true);
    expect(cfg.merchant).toEqual({
      enabled: true,
      feeCents: 500,
      minOrderCents: 0,
      instructions: null,
    });
    expect(cfg.uberDirect.enabled).toBe(false);
    expect(cfg.doordash.enabled).toBe(false);
    expect(cfg.customerChoosesProvider).toBe(false);
  });

  it('backfills a legacy uber_direct store', () => {
    const cfg = readFulfillmentConfig({
      fulfillmentConfig: {},
      deliveryProvider: 'uber_direct',
      deliveryFeeCents: 0,
    });
    expect(cfg.uberDirect.enabled).toBe(true);
    expect(cfg.merchant.enabled).toBe(false);
  });

  it('honours an explicit partial config over the legacy defaults', () => {
    const cfg = readFulfillmentConfig({
      fulfillmentConfig: {
        doordash: { enabled: true },
        merchant: { enabled: false },
        customerChoosesProvider: true,
      },
      deliveryProvider: 'self_manual',
      deliveryFeeCents: 999,
    });
    expect(cfg.doordash.enabled).toBe(true);
    expect(cfg.merchant.enabled).toBe(false);
    // feeCents still falls back to the legacy column
    expect(cfg.merchant.feeCents).toBe(999);
    expect(cfg.customerChoosesProvider).toBe(true);
  });

  it('ignores garbage values and clamps negatives', () => {
    const cfg = readFulfillmentConfig({
      fulfillmentConfig: {
        merchant: { enabled: 'yes', feeCents: -5, minOrderCents: 'lots', instructions: '  ' },
        pickup: 42,
      },
      deliveryProvider: 'self_manual',
      deliveryFeeCents: 300,
    });
    expect(cfg.merchant.enabled).toBe(true); // fallback (!legacyIsUber)
    expect(cfg.merchant.feeCents).toBe(300); // -5 rejected → legacy
    expect(cfg.merchant.minOrderCents).toBe(0);
    expect(cfg.merchant.instructions).toBeNull();
    expect(cfg.pickup.enabled).toBe(true);
  });

  it('round-trips through serializeFulfillmentConfig', () => {
    const input = {
      fulfillmentConfig: {
        pickup: { enabled: false, instructions: 'Ring the bell' },
        merchant: { enabled: true, feeCents: 450, minOrderCents: 2000, instructions: null },
        uberDirect: { enabled: true },
        doordash: { enabled: false },
        customerChoosesProvider: true,
      },
      deliveryProvider: 'uber_direct',
      deliveryFeeCents: 0,
    };
    const a = readFulfillmentConfig(input);
    const b = readFulfillmentConfig({ ...input, fulfillmentConfig: serializeFulfillmentConfig(a) });
    expect(b).toEqual(a);
  });
});

describe('enabledProviderTypes', () => {
  it('lists couriers first, then merchant, then pickup', () => {
    const cfg = readFulfillmentConfig({
      fulfillmentConfig: {
        uberDirect: { enabled: true },
        doordash: { enabled: true },
        merchant: { enabled: true },
        pickup: { enabled: true },
      },
      deliveryProvider: 'self_manual',
      deliveryFeeCents: 0,
    });
    expect(enabledProviderTypes(cfg)).toEqual(['UBER_DIRECT', 'DOORDASH', 'MERCHANT', 'PICKUP']);
  });
});

describe('resolveOrderProviderType (Prompt #13 R2)', () => {
  const uberOnly = readFulfillmentConfig({
    fulfillmentConfig: { uberDirect: { enabled: true }, merchant: { enabled: false } },
    deliveryProvider: 'uber_direct',
    deliveryFeeCents: 0,
  });

  it('honours an explicit pick that IS enabled', () => {
    const cfg = readFulfillmentConfig({
      fulfillmentConfig: { doordash: { enabled: true }, merchant: { enabled: true } },
      deliveryProvider: 'self_manual',
      deliveryFeeCents: 0,
    });
    expect(resolveOrderProviderType('DOORDASH', cfg)).toBe('DOORDASH');
  });

  it('ignores an explicit pick that is NOT enabled and falls back to the config default', () => {
    expect(resolveOrderProviderType('DOORDASH', uberOnly)).toBe('UBER_DIRECT');
  });

  it('ignores an unknown / garbage explicit value', () => {
    expect(resolveOrderProviderType('LYFT', uberOnly)).toBe('UBER_DIRECT');
    expect(resolveOrderProviderType('', uberOnly)).toBe('UBER_DIRECT');
  });

  it('falls back to MERCHANT when no courier is enabled', () => {
    const merchantOnly = readFulfillmentConfig({
      fulfillmentConfig: { merchant: { enabled: true } },
      deliveryProvider: 'self_manual',
      deliveryFeeCents: 500,
    });
    expect(resolveOrderProviderType('UBER_DIRECT', merchantOnly)).toBe('MERCHANT');
    expect(resolveOrderProviderType(null, merchantOnly)).toBe('MERCHANT');
  });
});
