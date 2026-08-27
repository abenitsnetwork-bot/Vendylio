import { describe, it, expect } from 'vitest';
import { createSelfManualProvider } from './self-manual';

describe('createSelfManualProvider', () => {
  it('requestDelivery returns REQUESTED with no external id (no dispatch call)', async () => {
    const provider = createSelfManualProvider();
    const result = await provider.requestDelivery({
      orderId: 'order-1',
      storeId: 'store-1',
      customerName: 'Amara',
      customerPhone: '+15551234567',
      deliveryAddress: null,
      pickupAddress: null,
      storeName: 'Amara Shop',
      storePhone: null,
      amountCents: 4500,
      manifestItems: [],
    });
    expect(result).toEqual({ providerDeliveryId: null, status: 'REQUESTED' });
  });

  it('markDelivered always succeeds (trusts the seller, no external confirmation)', async () => {
    const provider = createSelfManualProvider();
    const result = await provider.markDelivered(null);
    expect(result).toEqual({ status: 'DELIVERED' });
  });
});
