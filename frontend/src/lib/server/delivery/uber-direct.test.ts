import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DeliveryRequestInput } from './provider';

const mockGetAccessToken = vi.fn(async () => 'access-token-123');
const mockCreateQuote = vi.fn(async (_req: Record<string, unknown>) => ({ id: 'quote-1' }));
const mockCreateDelivery = vi.fn(async (_req: Record<string, unknown>) => ({
  id: 'del-abc',
  tracking_url: 'https://track.example/del-abc',
}));
const mockCreateDeliveriesClient = vi.fn((_token: string, _customerId: string) => ({
  createQuote: mockCreateQuote,
  createDelivery: mockCreateDelivery,
}));

vi.mock('uber-direct', () => ({
  getAccessToken: () => mockGetAccessToken(),
  createDeliveriesClient: (token: string, customerId: string) =>
    mockCreateDeliveriesClient(token, customerId),
}));

const BASE_INPUT: DeliveryRequestInput = {
  orderId: 'order-1',
  storeId: 'store-1',
  customerName: 'Amara',
  customerPhone: '+15551234567',
  deliveryAddress: { street: '10 Main St', city: 'Springfield', state: 'IL', zip: '62704' },
  pickupAddress: '1 Pickup Ave, Springfield, IL 62704',
  storeName: 'Amara Shop',
  storePhone: '+15559990000',
  amountCents: 4500,
  manifestItems: [{ name: 'Widget', quantity: 2 }],
};

async function freshProvider() {
  vi.resetModules();
  const mod = await import('./uber-direct');
  return mod;
}

describe('createUberDirectProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('access-token-123');
    mockCreateQuote.mockResolvedValue({ id: 'quote-1' });
    mockCreateDelivery.mockResolvedValue({
      id: 'del-abc',
      tracking_url: 'https://track.example/del-abc',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws UberDirectNotConfiguredError when env vars are missing', async () => {
    vi.unstubAllEnvs();
    const { createUberDirectProvider, UberDirectNotConfiguredError } = await freshProvider();
    const provider = createUberDirectProvider();
    await expect(provider.requestDelivery(BASE_INPUT)).rejects.toThrow(
      UberDirectNotConfiguredError,
    );
    expect(mockGetAccessToken).not.toHaveBeenCalled();
  });

  describe('once configured', () => {
    beforeEach(() => {
      vi.stubEnv('UBER_DIRECT_CLIENT_ID', 'client-id');
      vi.stubEnv('UBER_DIRECT_CLIENT_SECRET', 'client-secret');
      vi.stubEnv('UBER_DIRECT_CUSTOMER_ID', 'customer-id');
    });

    it('throws UberDirectMissingDetailsError when the store has no pickup address', async () => {
      const { createUberDirectProvider, UberDirectMissingDetailsError } = await freshProvider();
      const provider = createUberDirectProvider();
      await expect(
        provider.requestDelivery({ ...BASE_INPUT, pickupAddress: null }),
      ).rejects.toThrow(UberDirectMissingDetailsError);
    });

    it('throws UberDirectMissingDetailsError when the store has no phone number', async () => {
      const { createUberDirectProvider, UberDirectMissingDetailsError } = await freshProvider();
      const provider = createUberDirectProvider();
      await expect(provider.requestDelivery({ ...BASE_INPUT, storePhone: null })).rejects.toThrow(
        UberDirectMissingDetailsError,
      );
    });

    it('throws UberDirectMissingDetailsError when the order has no delivery address', async () => {
      const { createUberDirectProvider, UberDirectMissingDetailsError } = await freshProvider();
      const provider = createUberDirectProvider();
      await expect(
        provider.requestDelivery({ ...BASE_INPUT, deliveryAddress: null }),
      ).rejects.toThrow(UberDirectMissingDetailsError);
    });

    it('throws UberDirectMissingDetailsError when the order has no customer phone', async () => {
      const { createUberDirectProvider, UberDirectMissingDetailsError } = await freshProvider();
      const provider = createUberDirectProvider();
      await expect(
        provider.requestDelivery({ ...BASE_INPUT, customerPhone: null }),
      ).rejects.toThrow(UberDirectMissingDetailsError);
    });

    it('requests a quote then a delivery using snake_case fields, and returns the mapped result', async () => {
      const { createUberDirectProvider } = await freshProvider();
      const provider = createUberDirectProvider();

      const result = await provider.requestDelivery(BASE_INPUT);

      expect(mockGetAccessToken).toHaveBeenCalledTimes(1);
      expect(mockCreateDeliveriesClient).toHaveBeenCalledWith('access-token-123', 'customer-id');
      expect(mockCreateQuote).toHaveBeenCalledWith({
        pickup_address: BASE_INPUT.pickupAddress,
        dropoff_address: '10 Main St, Springfield, IL, 62704',
        manifest_total_value: 4500,
      });
      expect(mockCreateDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          pickup_name: 'Amara Shop',
          pickup_address: BASE_INPUT.pickupAddress,
          pickup_phone_number: '+15559990000',
          dropoff_name: 'Amara',
          dropoff_address: '10 Main St, Springfield, IL, 62704',
          dropoff_phone_number: '+15551234567',
          manifest_total_value: 4500,
          manifest_items: [{ name: 'Widget', quantity: 2, size: 'small' }],
          quote_id: 'quote-1',
          external_id: 'order-1',
        }),
      );
      expect(mockCreateDelivery.mock.calls[0]?.[0]).not.toHaveProperty('testSpecifications');
      expect(result).toEqual({
        providerDeliveryId: 'del-abc',
        status: 'REQUESTED',
        trackingUrl: 'https://track.example/del-abc',
      });
    });

    it('attaches robo-courier test specifications when sandbox mode is on', async () => {
      vi.stubEnv('UBER_DIRECT_SANDBOX_TEST_MODE', '1');
      const { createUberDirectProvider } = await freshProvider();
      const provider = createUberDirectProvider();

      await provider.requestDelivery(BASE_INPUT);

      expect(mockCreateDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          testSpecifications: { roboCourierSpecification: { mode: 'auto' } },
        }),
      );
    });

    it('wraps a rejected quote request in UberDirectRequestFailedError', async () => {
      mockCreateQuote.mockRejectedValue(new Error('bad request'));
      const { createUberDirectProvider, UberDirectRequestFailedError } = await freshProvider();
      const provider = createUberDirectProvider();
      await expect(provider.requestDelivery(BASE_INPUT)).rejects.toThrow(
        UberDirectRequestFailedError,
      );
    });

    it('wraps a rejected delivery creation in UberDirectRequestFailedError', async () => {
      mockCreateDelivery.mockRejectedValue(new Error('capacity exceeded'));
      const { createUberDirectProvider, UberDirectRequestFailedError } = await freshProvider();
      const provider = createUberDirectProvider();
      await expect(provider.requestDelivery(BASE_INPUT)).rejects.toThrow(
        UberDirectRequestFailedError,
      );
    });
  });

  it('markDelivered throws UberDirectManualConfirmationNotSupportedError — completion is webhook-driven', async () => {
    const { createUberDirectProvider, UberDirectManualConfirmationNotSupportedError } =
      await freshProvider();
    const provider = createUberDirectProvider();
    await expect(provider.markDelivered('del-abc')).rejects.toThrow(
      UberDirectManualConfirmationNotSupportedError,
    );
  });
});
