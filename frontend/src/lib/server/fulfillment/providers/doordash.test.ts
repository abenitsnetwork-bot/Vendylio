import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDoorDashFulfillmentProvider } from './doordash';
import { __resetDoorDashJwtCache } from './doordash-jwt';

const CREDS_ENV = {
  DOORDASH_DEVELOPER_ID: 'dev',
  DOORDASH_KEY_ID: 'key',
  DOORDASH_SIGNING_SECRET: Buffer.from('secret').toString('base64'),
};

function mockFetchOnce(status: number, body: unknown) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  });
}

const input = {
  pickupAddress: '1 Main St, Springfield, IL',
  pickupPhone: '+15550000000',
  dropoffAddress: { street: '2 Elm St', city: 'Springfield', state: 'IL', zip: '62704' },
  dropoffPhone: '+15551111111',
  subtotalCents: 4200,
  currency: 'USD',
};

const createInput = {
  externalDeliveryId: 'vend_del_1',
  orderId: 'ord_1',
  storeId: 'store_1',
  storeName: 'Shop',
  pickupAddress: '1 Main St',
  pickupPhone: '+15550000000',
  customerName: 'Jo',
  customerPhone: '+15551111111',
  dropoffAddress: { street: '2 Elm St', city: 'Springfield', state: 'IL', zip: '62704' },
  subtotalCents: 4200,
  currency: 'USD',
  manifestItems: [{ name: 'Widget', quantity: 1 }],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  for (const [k, v] of Object.entries(CREDS_ENV)) vi.stubEnv(k, v);
  __resetDoorDashJwtCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  __resetDoorDashJwtCache();
});

describe('doordash provider — quote', () => {
  it('returns a serviceable quote with the fee + ETA', async () => {
    mockFetchOnce(200, {
      fee: 899,
      currency: 'USD',
      dropoff_time_estimated: '2026-09-01T18:30:00Z',
    });
    const q = await createDoorDashFulfillmentProvider().quote(input);
    expect(q).toMatchObject({ provider: 'DOORDASH', serviceable: true, feeCents: 899 });
    expect(q.estimatedDropoffAt).toBeInstanceOf(Date);
    expect(q.expiresAt).toBeInstanceOf(Date);
  });

  it('is unserviceable when DoorDash 422s the address (out of coverage)', async () => {
    mockFetchOnce(422, { code: 'validation_error', message: 'no coverage' });
    const q = await createDoorDashFulfillmentProvider().quote(input);
    expect(q.serviceable).toBe(false);
    expect(q.unserviceableReason).toMatch(/coverage/i);
  });

  it('is unserviceable (not throwing) when not configured', async () => {
    vi.unstubAllEnvs();
    const q = await createDoorDashFulfillmentProvider().quote(input);
    expect(q.serviceable).toBe(false);
  });
});

describe('doordash provider — createDelivery', () => {
  it('creates a delivery and maps the result', async () => {
    mockFetchOnce(200, {
      external_delivery_id: 'vend_del_1',
      delivery_status: 'created',
      tracking_url: 'https://doordash/track/abc',
      fee: 899,
    });
    const r = await createDoorDashFulfillmentProvider().createDelivery(createInput);
    expect(r).toMatchObject({
      providerDeliveryId: 'vend_del_1',
      state: 'REQUESTED',
      trackingUrl: 'https://doordash/track/abc',
      providerCostCents: 899,
    });
  });

  it('treats a duplicate_delivery_id conflict as already-created and hydrates via GET', async () => {
    mockFetchOnce(409, { code: 'duplicate_delivery_id', message: 'exists' });
    mockFetchOnce(200, {
      external_delivery_id: 'vend_del_1',
      delivery_status: 'dasher_confirmed',
      tracking_url: 'https://doordash/track/abc',
    });
    const r = await createDoorDashFulfillmentProvider().createDelivery(createInput);
    expect(r.deduplicated).toBe(true);
    expect(r.state).toBe('CONFIRMED');
  });

  it('propagates a non-duplicate error', async () => {
    mockFetchOnce(400, { code: 'bad_request', message: 'nope' });
    await expect(createDoorDashFulfillmentProvider().createDelivery(createInput)).rejects.toThrow(
      /nope/,
    );
  });
});

describe('doordash provider — getDelivery / cancel / testConnection', () => {
  it('getDelivery maps the snapshot', async () => {
    mockFetchOnce(200, { external_delivery_id: 'vend_del_1', delivery_status: 'picked_up' });
    const s = await createDoorDashFulfillmentProvider().getDelivery('vend_del_1');
    expect(s.state).toBe('PICKED_UP');
  });

  it('getDelivery returns UNKNOWN on error rather than throwing', async () => {
    mockFetchOnce(500, { message: 'boom' });
    const s = await createDoorDashFulfillmentProvider().getDelivery('vend_del_1');
    expect(s.state).toBe('UNKNOWN');
  });

  it('cancelDelivery reports refusal when DoorDash will not cancel', async () => {
    mockFetchOnce(422, { code: 'cancellation_not_allowed', message: 'dasher assigned' });
    const r = await createDoorDashFulfillmentProvider().cancelDelivery('vend_del_1');
    expect(r.cancelled).toBe(false);
  });

  it('testConnection is ok on a 404 (auth proven, no driver dispatched)', async () => {
    mockFetchOnce(404, { message: 'not found' });
    const r = await createDoorDashFulfillmentProvider().testConnection();
    expect(r.ok).toBe(true);
  });

  it('testConnection fails on 401', async () => {
    mockFetchOnce(401, { message: 'unauthorized' });
    const r = await createDoorDashFulfillmentProvider().testConnection();
    expect(r.ok).toBe(false);
  });
});
